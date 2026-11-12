import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  type OrchestrationV2ConversationMessage,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vite-plus/test";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PromptCompletion from "./PromptCompletion.ts";

const threadId = ThreadId.make("thread:completion");
const at = DateTime.makeUnsafe("2026-11-11T00:00:00.000Z");
const message = (
  index: number,
  role: "user" | "assistant",
  text: string,
  streaming = false,
): OrchestrationV2ConversationMessage => ({
  id: MessageId.make(`message-${index}`),
  threadId,
  runId: null,
  nodeId: null,
  role,
  text,
  attachments: [],
  streaming,
  createdAt: at,
  updatedAt: at,
  createdBy: role === "user" ? "user" : "agent",
  creationSource: "web",
});

const run = (input: {
  readonly settings: Partial<typeof DEFAULT_SERVER_SETTINGS>;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly reply: string;
  readonly prompts: Array<string>;
}) =>
  PromptCompletion.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, ...input.settings }),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: (request) => {
            input.prompts.push(request.prompt);
            return Effect.succeed({ transcription: input.reply });
          },
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () =>
            Effect.succeed({
              thread: { projectId: ProjectId.make("project:acme") },
              messages: input.messages,
            } as never),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeedSome({ title: "acme-app" } as ProjectStore.ProjectRow),
        }),
      ),
    ),
  );

describe("PromptCompletion", () => {
  it.effect("asks the model only when the mode is on and the reply has finished", () =>
    Effect.gen(function* () {
      const prompts: Array<string> = [];
      const complete = (
        settings: Partial<typeof DEFAULT_SERVER_SETTINGS>,
        messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
        mode: "continue" | "next",
        draft = "",
      ) =>
        PromptCompletion.PromptCompletion.pipe(
          Effect.flatMap((service) => service.complete({ threadId, mode, draft })),
          Effect.provide(
            run({
              settings,
              messages,
              reply: "1. Run the tests\n- Merge it\nRun the tests",
              prompts,
            }),
          ),
        );
      const history = [
        ...Array.from({ length: 8 }, (_, index) => message(index, "user", `older ${index}`)),
        message(8, "assistant", `${"x".repeat(2_000)} Done: the build passes.`),
      ];

      expect(yield* complete({}, history, "next")).toEqual({ suggestions: [] });
      expect(
        yield* complete(
          { promptCompletionNextEnabled: true },
          [...history, message(9, "assistant", "Still working", true)],
          "next",
        ),
      ).toEqual({ suggestions: [] });
      expect(prompts).toHaveLength(0);

      expect(yield* complete({ promptCompletionNextEnabled: true }, history, "next")).toEqual({
        suggestions: ["Run the tests", "Merge it"],
      });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("<project>acme-app</project>");
      expect(prompts[0]).toContain("Done: the build passes.");
      expect(prompts[0]).not.toContain("older 2");
      expect(prompts[0]).not.toContain("x".repeat(1_300));

      expect(
        yield* complete({ promptCompletionInlineEnabled: true }, history, "continue", "  "),
      ).toEqual({
        suggestions: [],
      });
      expect(prompts).toHaveLength(1);
    }),
  );

  it("drops a corrected rewrite of the existing draft", () => {
    expect(
      PromptCompletion.parsePromptCompletion(
        "continue",
        "ya esta todo donde lo quiero entonces?",
        "Ya está todo donde lo quiero entonces?",
      ),
    ).toEqual([]);
  });

  it("keeps a continuation to its first line and drops an echoed draft", () => {
    expect(
      PromptCompletion.parsePromptCompletion("continue", "Run the", "Run the tests now\nand more"),
    ).toEqual([" tests now"]);
    expect(PromptCompletion.parsePromptCompletion("continue", "Run the ", "tests")).toEqual([
      "tests",
    ]);
    expect(PromptCompletion.parsePromptCompletion("continue", "Done", "   ")).toEqual([]);
    expect(
      PromptCompletion.parsePromptCompletion(
        "continue",
        "Run tests\nthen deploy",
        "Run tests\nthen deploy and report",
      ),
    ).toEqual([" and report"]);
    expect(PromptCompletion.parsePromptCompletion("continue", "quier", "o entonces")).toEqual([
      "o entonces",
    ]);
  });
});
