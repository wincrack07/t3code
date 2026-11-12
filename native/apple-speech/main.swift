// T3 Code Apple speech helper.
//
// Usage:
//   t3-apple-speech --capabilities        print the capabilities line and exit
//   t3-apple-speech --install <locale>    install Apple's on-device asset for a locale
//   t3-apple-speech --locale <locale>     transcribe 16 kHz mono Float32LE PCM from stdin
//
// Every run prints newline-delimited JSON on stdout. The first line is always
// {"type":"capabilities",...}. Recognition never leaves the Mac: when a locale
// cannot be recognized on device the helper reports an error instead.

import AVFoundation
import Foundation
import Speech

let sampleRate = 16_000.0
let outputLock = NSLock()

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  else { return }
  outputLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
  outputLock.unlock()
}

func fail(_ message: String) -> Never {
  emit(["type": "error", "message": message])
  exit(1)
}

func tag(_ locale: Locale) -> String { locale.identifier(.bcp47) }

var osVersion: String {
  let version = ProcessInfo.processInfo.operatingSystemVersion
  return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
}

/// Picks the locale for a request such as "es", "es-MX" or "auto": an exact match first, then an
/// installed locale of that language preferring the person's own region, then any supported one.
func resolveLocale(_ request: String, supported: [Locale], installed: [Locale]) -> Locale? {
  let preferred = Locale.preferredLanguages.map { Locale(identifier: $0) }
  let wanted: String
  if request == "auto" {
    wanted = Locale.current.language.languageCode?.identifier ?? "en"
  } else {
    wanted = request
  }
  let normalized = wanted.replacingOccurrences(of: "_", with: "-").lowercased()
  if let exact = supported.first(where: { tag($0).lowercased() == normalized }) { return exact }
  let language = String(normalized.split(separator: "-").first ?? "")
  let sameLanguage = { (locale: Locale) in locale.language.languageCode?.identifier == language }
  let regions = ([Locale.current] + preferred).compactMap { $0.region?.identifier }
  for pool in [installed.filter(sameLanguage), supported.filter(sameLanguage)] {
    if let regional = pool.first(where: { regions.contains($0.region?.identifier ?? "") }) {
      return regional
    }
    if let first = pool.first { return first }
  }
  return nil
}

/// Reads Float32LE samples from stdin until EOF, calling `onSamples` on a background thread.
func readStdin(_ onSamples: @escaping ([Float]) -> Void, done: @escaping () -> Void) {
  Thread.detachNewThread {
    var carry = Data()
    while true {
      let chunk = FileHandle.standardInput.availableData
      if chunk.isEmpty { break }
      carry.append(chunk)
      let usable = carry.count - carry.count % 4
      if usable == 0 { continue }
      let samples = carry.prefix(usable).withUnsafeBytes { raw in
        Array(raw.bindMemory(to: Float.self))
      }
      carry.removeFirst(usable)
      onSamples(samples)
    }
    done()
  }
}

func floatBuffer(_ samples: [Float], format: AVAudioFormat) -> AVAudioPCMBuffer? {
  guard
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
    let channel = buffer.floatChannelData?[0]
  else { return nil }
  buffer.frameLength = AVAudioFrameCount(samples.count)
  samples.withUnsafeBufferPointer { channel.update(from: $0.baseAddress!, count: samples.count) }
  return buffer
}

let inputFormat = AVAudioFormat(
  commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!

// MARK: - SpeechAnalyzer (macOS 26 and later)

#if compiler(>=6.2)
  @available(macOS 26.0, *)
  enum Analyzer {
    static func locales() async -> (supported: [Locale], installed: [Locale]) {
      let supported = await SpeechTranscriber.supportedLocales
      let installed = await SpeechTranscriber.installedLocales
      return (supported, installed)
    }

    static func capabilities() async -> [String: Any] {
      let (supported, installed) = await locales()
      return [
        "type": "capabilities", "os": osVersion, "engine": "SpeechAnalyzer",
        "available": SpeechTranscriber.isAvailable,
        "supported": supported.map(tag).sorted(), "installed": installed.map(tag).sorted(),
      ]
    }

    static func transcriber(_ locale: Locale) -> SpeechTranscriber {
      SpeechTranscriber(
        locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults],
        attributeOptions: [])
    }

    static func install(_ locale: Locale) async throws {
      let module = transcriber(locale)
      guard let request = try await AssetInventory.assetInstallationRequest(supporting: [module])
      else {
        emit(["type": "installed", "locale": tag(locale)])
        return
      }
      emit(["type": "install", "locale": tag(locale), "progress": 0])
      let progress = request.progress
      let observer = progress.observe(\.fractionCompleted) { progress, _ in
        emit(["type": "install", "locale": tag(locale), "progress": progress.fractionCompleted])
      }
      defer { observer.invalidate() }
      try await request.downloadAndInstall()
      emit(["type": "installed", "locale": tag(locale)])
    }

    static func run(_ request: String) async throws {
      let (supported, installed) = await locales()
      guard let locale = resolveLocale(request, supported: supported, installed: installed) else {
        fail("macOS can't recognize \(request) on this Mac.")
      }
      if !installed.contains(where: { tag($0) == tag(locale) }) { try await install(locale) }
      let module = transcriber(locale)
      guard
        let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]),
        let converter = AVAudioConverter(from: inputFormat, to: format)
      else { fail("No audio format is available for \(tag(locale)).") }
      let (input, builder) = AsyncStream<AnalyzerInput>.makeStream()
      let analyzer = SpeechAnalyzer(modules: [module])
      let results = Task {
        for try await result in module.results {
          let text = String(result.text.characters)
          emit(["type": result.isFinal ? "final" : "partial", "text": text])
        }
      }
      try await analyzer.start(inputSequence: input)
      emit(["type": "ready", "locale": tag(locale), "engine": "SpeechAnalyzer"])
      let ended = AsyncStream<Void>.makeStream()
      readStdin(
        { samples in
          guard let source = floatBuffer(samples, format: inputFormat) else { return }
          let ratio = format.sampleRate / sampleRate
          let capacity = AVAudioFrameCount(Double(samples.count) * ratio) + 32
          guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity)
          else { return }
          var consumed = false
          var error: NSError?
          converter.convert(to: converted, error: &error) { _, status in
            if consumed {
              status.pointee = .noDataNow
              return nil
            }
            consumed = true
            status.pointee = .haveData
            return source
          }
          if error == nil, converted.frameLength > 0 { builder.yield(AnalyzerInput(buffer: converted)) }
        },
        done: {
          builder.finish()
          ended.continuation.finish()
        })
      for await _ in ended.stream {}
      try await analyzer.finalizeAndFinishThroughEndOfInput()
      try await results.value
      emit(["type": "done"])
    }
  }
#endif

// MARK: - SFSpeechRecognizer on device (earlier macOS)

enum Legacy {
  static func supported() -> [Locale] {
    SFSpeechRecognizer.supportedLocales().filter {
      SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true
    }
  }

  static func capabilities() -> [String: Any] {
    let locales = supported().map(tag).sorted()
    return [
      "type": "capabilities", "os": osVersion, "engine": "SFSpeechRecognizer",
      "available": !locales.isEmpty, "supported": locales, "installed": locales,
    ]
  }

  static func authorize() async -> Bool {
    if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
    return await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
    }
  }

  static func run(_ request: String) async {
    let locales = supported()
    guard
      let locale = resolveLocale(request, supported: locales, installed: locales),
      let recognizer = SFSpeechRecognizer(locale: locale),
      recognizer.supportsOnDeviceRecognition
    else { fail("macOS can't recognize \(request) on this Mac without sending audio to Apple.") }
    guard await authorize() else { fail("Speech Recognition permission is off for T3 Code.") }
    let speech = SFSpeechAudioBufferRecognitionRequest()
    speech.requiresOnDeviceRecognition = true
    speech.shouldReportPartialResults = true
    let finished = AsyncStream<Void>.makeStream()
    let task = recognizer.recognitionTask(with: speech) { result, error in
      if let result {
        let text = result.bestTranscription.formattedString
        emit(["type": result.isFinal ? "final" : "partial", "text": text])
        if result.isFinal { finished.continuation.finish() }
      }
      if let error {
        emit(["type": "error", "message": error.localizedDescription])
        finished.continuation.finish()
      }
    }
    emit(["type": "ready", "locale": tag(locale), "engine": "SFSpeechRecognizer"])
    readStdin(
      { samples in
        if let buffer = floatBuffer(samples, format: inputFormat) { speech.append(buffer) }
      }, done: { speech.endAudio() })
    for await _ in finished.stream {}
    _ = task
    emit(["type": "done"])
  }
}

// MARK: - Entry

func value(after flag: String) -> String? {
  let args = CommandLine.arguments
  guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
  return args[index + 1]
}

func main() async {
  setvbuf(stdout, nil, _IONBF, 0)
  let args = CommandLine.arguments
  #if compiler(>=6.2)
    if #available(macOS 26.0, *), SpeechTranscriber.isAvailable {
      emit(await Analyzer.capabilities())
      do {
        if args.contains("--capabilities") { return }
        if let request = value(after: "--install") {
          let (supported, installed) = await Analyzer.locales()
          guard let locale = resolveLocale(request, supported: supported, installed: installed)
          else { fail("macOS can't recognize \(request) on this Mac.") }
          try await Analyzer.install(locale)
          return
        }
        guard let request = value(after: "--locale") else { fail("Pass --locale <locale>.") }
        try await Analyzer.run(request)
      } catch {
        fail(error.localizedDescription)
      }
      return
    }
  #endif
  emit(Legacy.capabilities())
  if args.contains("--capabilities") { return }
  if value(after: "--install") != nil {
    fail("This version of macOS installs speech languages in System Settings → Keyboard → Dictation.")
  }
  guard let request = value(after: "--locale") else { fail("Pass --locale <locale>.") }
  await Legacy.run(request)
}

let done = DispatchSemaphore(value: 0)
Task {
  await main()
  done.signal()
}
done.wait()
exit(0)
