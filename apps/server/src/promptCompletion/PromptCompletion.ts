import {
  PROMPT_COMPLETION_MAX_SUGGESTIONS,
  PROMPT_CONTINUE_INSTRUCTIONS,
  PROMPT_NEXT_INSTRUCTIONS,
  TextGenerationError,
  type OrchestrationV2ConversationMessage,
  type PromptCompletionInput,
  type PromptCompletionResult,
} from "@t3tools/contracts";
import { resolvePromptCompletionModelSelection } from "@t3tools/shared/serverSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export class PromptCompletion extends Context.Service<
  PromptCompletion,
  {
    readonly complete: (
      input: PromptCompletionInput,
    ) => Effect.Effect<PromptCompletionResult, TextGenerationError>;
  }
>()("t3/promptCompletion/PromptCompletion") {}

const HISTORY_MESSAGES = 6;
const HISTORY_MESSAGE_CHARS = 1_200;
const SUGGESTION_MAX_CHARS = 120;
/** A suggestion that arrives later than this is no longer what the user is looking at. */
const COMPLETION_TIMEOUT = "6 seconds";

const NONE: PromptCompletionResult = { suggestions: [] };
const isTextGenerationError = Schema.is(TextGenerationError);

/** The newest messages, each clipped to its end, where a reply's conclusion and asks sit. */
type HistoryMessage = Pick<OrchestrationV2ConversationMessage, "role" | "text">;

function historyBlock(messages: ReadonlyArray<HistoryMessage>): string {
  return messages
    .slice(-HISTORY_MESSAGES)
    .map((message) => {
      const text = message.text.trim();
      const clipped =
        text.length > HISTORY_MESSAGE_CHARS ? `…${text.slice(-HISTORY_MESSAGE_CHARS)}` : text;
      return `<${message.role === "user" ? "developer" : "agent"}>\n${clipped}\n</${message.role === "user" ? "developer" : "agent"}>`;
    })
    .join("\n");
}

export function buildPromptCompletionPrompt(input: {
  readonly mode: PromptCompletionInput["mode"];
  readonly draft: string;
  readonly projectTitle: string | null;
  readonly messages: ReadonlyArray<HistoryMessage>;
}): string {
  return [
    input.mode === "continue" ? PROMPT_CONTINUE_INSTRUCTIONS : PROMPT_NEXT_INSTRUCTIONS,
    input.projectTitle ? `<project>${input.projectTitle}</project>` : "",
    `<conversation>\n${historyBlock(input.messages)}\n</conversation>`,
    input.mode === "continue" ? `<draft>${input.draft}</draft>` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** Model output to suggestions: one line each, no list markers or quotes, nothing that repeats the draft. */
export function parsePromptCompletion(
  mode: PromptCompletionInput["mode"],
  draft: string,
  output: string,
): ReadonlyArray<string> {
  const lines = output
    .split(/\r?\n/u)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")
        .replace(/^["'“]|["'”]$/gu, "")
        .slice(0, SUGGESTION_MAX_CHARS),
    )
    .filter((line) => line.trim().length > 0);
  if (mode === "next") {
    return [...new Set(lines.map((line) => line.trim()))].slice(
      0,
      PROMPT_COMPLETION_MAX_SUGGESTIONS,
    );
  }
  const first = lines[0];
  if (first === undefined) return [];
  // Models often echo the draft before continuing it.
  const continuation = first.startsWith(draft) ? first.slice(draft.length) : first;
  if (continuation.trim().length === 0) return [];
  const needsSpace = !/\s$/u.test(draft) && !/^[\s.,;:!?)]/u.test(continuation);
  return [needsSpace && draft.length > 0 ? ` ${continuation.trimStart()}` : continuation];
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;

  const complete = Effect.fn("PromptCompletion.complete")(
    function* (input: PromptCompletionInput) {
      const settings = yield* settingsService.getSettings;
      const enabled =
        input.mode === "continue"
          ? settings.promptCompletionInlineEnabled
          : settings.promptCompletionNextEnabled;
      if (!enabled || (input.mode === "continue" && input.draft.trim().length === 0)) return NONE;
      const records = yield* threads.getThreadRecords(input.threadId, ["messages"], {
        messageRoles: ["user", "assistant"],
      });
      const messages = records.messages;
      const last = messages.at(-1);
      // Next prompts answer a finished reply; there is nothing to answer yet otherwise.
      if (input.mode === "next" && (last?.role !== "assistant" || last.streaming)) return NONE;
      const project = yield* projects.get(records.thread.projectId);
      // Providers run in a working directory; a suggestion must not read a checkout.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-prompt-completion-" });
      const generated = yield* textGeneration
        .generateTranscriptionPostProcessing({
          cwd,
          prompt: buildPromptCompletionPrompt({
            mode: input.mode,
            draft: input.draft,
            projectTitle: Option.match(project, {
              onNone: () => null,
              onSome: (row) => row.title,
            }),
            messages: messages.filter((message) => !message.streaming),
          }),
          modelSelection: resolvePromptCompletionModelSelection(settings),
        })
        .pipe(Effect.timeoutOption(COMPLETION_TIMEOUT));
      return Option.match(generated, {
        onNone: () => NONE,
        onSome: (result) => ({
          suggestions: parsePromptCompletion(input.mode, input.draft, result.transcription),
        }),
      });
    },
    Effect.scoped,
    Effect.mapError((cause) =>
      isTextGenerationError(cause)
        ? cause
        : new TextGenerationError({
            operation: "completePrompt",
            detail: "Could not prepare a prompt suggestion.",
            cause,
          }),
    ),
  );

  return PromptCompletion.of({ complete });
});

export const layer = Layer.effect(PromptCompletion, make);
