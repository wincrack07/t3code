// @effect-diagnostics nodeBuiltinImport:off - the helper is a killable child process driven from Promise boundaries like native.ts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { SpeechStreamText } from "@t3tools/contracts";

export const APPLE_SPEECH_MODEL_ID = "apple/speech";
const HELPER_NAME = "t3-apple-speech";

export type AppleSpeechCapabilities = {
  readonly os: string;
  readonly engine: string;
  readonly available: boolean;
  readonly supported: readonly string[];
  readonly installed: readonly string[];
};

export type AppleSpeechMessage =
  | ({ readonly type: "capabilities" } & AppleSpeechCapabilities)
  | { readonly type: "ready"; readonly locale: string }
  | { readonly type: "install"; readonly progress: number }
  | { readonly type: "installed"; readonly locale: string }
  | { readonly type: "partial" | "final"; readonly text: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** Parses one stdout line of the helper; anything unexpected is ignored rather than trusted. */
export function parseAppleSpeechLine(line: string): AppleSpeechMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
  const message = value as Record<string, unknown>;
  const text = (key: string) => (typeof message[key] === "string" ? message[key] : undefined);
  switch (message.type) {
    case "capabilities":
      return {
        type: "capabilities",
        os: text("os") ?? "",
        engine: text("engine") ?? "",
        available: message.available === true,
        supported: strings(message.supported),
        installed: strings(message.installed),
      };
    case "ready":
    case "installed":
      return { type: message.type, locale: text("locale") ?? "" };
    case "install":
      return typeof message.progress === "number" && Number.isFinite(message.progress)
        ? { type: "install", progress: Math.min(1, Math.max(0, message.progress)) }
        : undefined;
    case "partial":
    case "final":
      return text("text") === undefined ? undefined : { type: message.type, text: text("text")! };
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: text("message") ?? "Apple speech failed." };
    default:
      return undefined;
  }
}

/** Language codes ("en", "es") the catalog advertises for a list of BCP-47 locales. */
export const appleSpeechLanguages = (locales: readonly string[]) =>
  [...new Set(locales.map((locale) => locale.split("-", 1)[0]!.toLowerCase()))].sort();

/**
 * Where a packaged, source or overridden helper may live. The packaged server runs from
 * `Resources/app.asar/apps/server/dist`, and the desktop build stages the helper beside it.
 */
export function appleSpeechHelperCandidates(input: {
  readonly platform: string;
  readonly override: string | undefined;
  readonly moduleDirectory: string;
}): string[] {
  if (input.platform !== "darwin") return [];
  const relative = NodePath.join("apple-speech", HELPER_NAME);
  return [
    ...(input.override ? [input.override] : []),
    NodePath.resolve(input.moduleDirectory, "../../../..", relative),
    NodePath.resolve(input.moduleDirectory, "../../../../native/apple-speech/build", HELPER_NAME),
    NodePath.resolve(input.moduleDirectory, "../../../native/apple-speech/build", HELPER_NAME),
  ];
}

export function findAppleSpeechHelper(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => {
    try {
      NodeFS.accessSync(candidate, NodeFS.constants.X_OK);
      return NodeFS.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/** The engine is offered only when the helper exists and macOS reports on-device support. */
export const isAppleSpeechAvailable = (capabilities: AppleSpeechCapabilities | undefined) =>
  capabilities !== undefined && capabilities.available && capabilities.supported.length > 0;

type Helper = {
  readonly lines: AsyncIterator<AppleSpeechMessage>;
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly kill: () => void;
  readonly exited: Promise<void>;
};

function spawnHelper(path: string, args: readonly string[], signal?: AbortSignal): Helper {
  const child = NodeChildProcess.spawn(path, args, { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  signal?.addEventListener("abort", kill, { once: true });
  void exited.then(() => signal?.removeEventListener("abort", kill));
  child.stdin.on("error", () => undefined);
  child.stderr.resume();
  const queue: AppleSpeechMessage[] = [];
  let waiting: ((result: IteratorResult<AppleSpeechMessage>) => void) | undefined;
  let ended = false;
  let buffer = "";
  const push = (message: AppleSpeechMessage | undefined) => {
    if (!message) return;
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve({ value: message, done: false });
    } else queue.push(message);
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      push(parseAppleSpeechLine(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const end = () => {
    ended = true;
    waiting?.({ value: undefined, done: true });
    waiting = undefined;
  };
  child.on("error", end);
  void exited.then(end);
  const lines: AsyncIterator<AppleSpeechMessage> = {
    next: () =>
      queue.length > 0
        ? Promise.resolve({ value: queue.shift()!, done: false })
        : ended
          ? Promise.resolve({ value: undefined, done: true })
          : new Promise((resolve) => {
              waiting = resolve;
            }),
  };
  return { lines, child, kill, exited };
}

async function next(helper: Helper, accept: (message: AppleSpeechMessage) => boolean) {
  for (;;) {
    const { value, done } = await helper.lines.next();
    if (done) throw new Error("Apple speech helper exited.");
    if (value.type === "error") throw new Error(value.message);
    if (accept(value)) return value;
  }
}

export async function readAppleSpeechCapabilities(
  path: string,
  signal?: AbortSignal,
): Promise<AppleSpeechCapabilities> {
  const helper = spawnHelper(path, ["--capabilities"], signal);
  try {
    const message = await next(helper, (entry) => entry.type === "capabilities");
    if (message.type !== "capabilities") throw new Error("Invalid Apple speech capabilities.");
    return message;
  } finally {
    helper.kill();
  }
}

/** Asks macOS to download the on-device asset for a language ("auto" means the Mac's own). */
export async function installAppleSpeechLanguage(
  path: string,
  language: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) {
  const helper = spawnHelper(path, ["--install", language], signal);
  try {
    await next(helper, (message) => {
      if (message.type === "install") onProgress(message.progress);
      return message.type === "installed";
    });
  } finally {
    helper.kill();
  }
}

type AppleSpeechOptions = { readonly language?: string };

/**
 * A handle shaped like a loaded native model. Nothing stays resident: each recording spawns
 * one helper process and `finish`, `reset` and `dispose` kill it.
 */
export function loadAppleSpeechModel(path: string, languages: readonly string[]) {
  let helper: Helper | undefined;
  let committed = "";
  let tentative = "";
  let changed = false;
  let failure: Error | undefined;
  let done: Promise<void> | undefined;
  const stop = async () => {
    const current = helper;
    helper = undefined;
    if (!current) return;
    current.kill();
    await current.exited;
  };
  const begin = async (options: AppleSpeechOptions) => {
    await stop();
    committed = tentative = "";
    changed = false;
    failure = undefined;
    const current = spawnHelper(path, ["--locale", options.language ?? "auto"]);
    helper = current;
    try {
      await next(current, (message) => message.type === "ready");
    } catch (error) {
      await stop();
      throw error;
    }
    done = (async () => {
      try {
        for (;;) {
          const message = await next(current, (entry) => entry.type !== "capabilities");
          if (message.type === "done") return;
          if (message.type === "final") {
            committed = [committed, message.text.trim()].filter(Boolean).join(" ");
            tentative = "";
            changed = true;
          } else if (message.type === "partial") {
            tentative = message.text.trim();
            changed = true;
          }
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    })();
  };
  const write = (pcm: Float32Array) => {
    if (failure) throw failure;
    if (!helper) throw new Error("Apple speech is not recording.");
    helper.child.stdin.write(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  };
  let revision = 0;
  const finish = async () => {
    if (!helper) throw new Error("Apple speech is not recording.");
    helper.child.stdin.end();
    await done;
    await stop();
    if (failure) throw failure;
    return [committed, tentative].filter(Boolean).join(" ");
  };
  return {
    backend: "apple",
    languages: [...languages],
    supportsStreaming: true,
    supportsLongForm: true,
    supportsTranslation: false,
    supportsVocabulary: false,
    begin: async (options: AppleSpeechOptions, _filterSilence: boolean, _vadPath?: string) =>
      begin(options),
    feed: async (pcm: Float32Array) => {
      write(pcm);
      const text: SpeechStreamText | null = changed ? { committed, tentative } : null;
      changed = false;
      return { revision: ++revision, text };
    },
    finish,
    reset: stop,
    transcribe: async (
      pcm: Float32Array,
      options: AppleSpeechOptions,
      _filterSilence: boolean,
      _vadPath?: string,
    ) => {
      await begin(options);
      write(pcm);
      return { text: await finish() };
    },
    dispose: stop,
  };
}
