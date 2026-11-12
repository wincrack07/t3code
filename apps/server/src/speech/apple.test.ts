// @effect-diagnostics nodeBuiltinImport:off - the fixture is an executable file a real child process runs.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import {
  appleSpeechHelperCandidates,
  appleSpeechLanguages,
  loadAppleSpeechModel,
  parseAppleSpeechLine,
} from "./apple.ts";

it("parses helper lines and ignores anything malformed", () => {
  expect(
    parseAppleSpeechLine(
      '{"type":"capabilities","os":"26.1","engine":"SpeechAnalyzer","available":true,"supported":["en-US","es-MX",3],"installed":["es-MX"]}',
    ),
  ).toEqual({
    type: "capabilities",
    os: "26.1",
    engine: "SpeechAnalyzer",
    available: true,
    supported: ["en-US", "es-MX"],
    installed: ["es-MX"],
  });
  expect(parseAppleSpeechLine('{"type":"partial","text":"Hola"}')).toEqual({
    type: "partial",
    text: "Hola",
  });
  expect(parseAppleSpeechLine('{"type":"install","progress":1.5}')).toEqual({
    type: "install",
    progress: 1,
  });
  expect(parseAppleSpeechLine('{"type":"error"}')).toEqual({
    type: "error",
    message: "Apple speech failed.",
  });
  for (const line of ["", "not json", "null", '{"type":"final"}', '{"type":"other"}'])
    expect(parseAppleSpeechLine(line)).toBeUndefined();
  expect(appleSpeechLanguages(["es-MX", "en-US", "es-ES", "zh-Hant-TW"])).toEqual([
    "en",
    "es",
    "zh",
  ]);
});

it("looks for the helper only on macOS", () => {
  const input = { override: "/override", moduleDirectory: "/app/apps/server/dist" };
  expect(appleSpeechHelperCandidates({ ...input, platform: "linux" })).toEqual([]);
  expect(appleSpeechHelperCandidates({ ...input, platform: "darwin" })[0]).toBe("/override");
});

it("joins final segments and keeps trailing volatile text when a recording ends", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-apple-speech-"));
  const helper = NodePath.join(directory, "t3-apple-speech");
  // A stand-in helper: a partial per stdin chunk, then a final segment and a newer partial.
  NodeFS.writeFileSync(
    helper,
    `#!${process.execPath}
const say = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
say({ type: "capabilities", available: true, supported: ["es-MX"], installed: ["es-MX"] });
if (process.argv[3] !== "es") { say({ type: "error", message: "bad locale " + process.argv[3] }); process.exit(1); }
say({ type: "ready", locale: "es-MX" });
let bytes = 0;
process.stdin.on("data", (d) => { bytes += d.length; say({ type: "partial", text: "hola " + bytes }); });
process.stdin.on("end", () => {
  say({ type: "final", text: "hola mundo " + bytes });
  say({ type: "partial", text: "y más" });
  say({ type: "done" });
});
`,
    { mode: 0o755 },
  );
  try {
    const model = loadAppleSpeechModel(helper, ["es"]);
    await model.begin({ language: "es" }, false);
    expect(await model.feed(new Float32Array(4))).toEqual({ revision: 1, text: null });
    expect(await model.finish()).toBe("hola mundo 16 y más");
    await expect(model.begin({ language: "fr" }, false)).rejects.toThrow("bad locale fr");
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
