import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PromptPolish from "./PromptPolish.ts";

const projectId = ProjectId.make("project-polish");
const projectModel: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "project-model",
};

const run = (reply: string, calls: Array<{ prompt: string; modelSelection: ModelSelection }>) =>
  PromptPolish.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            projectSettingsOverrides: {
              [projectId]: { textGenerationModelSelection: projectModel },
            },
          }),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: (input) => {
            calls.push({ prompt: input.prompt, modelSelection: input.modelSelection });
            return Effect.succeed({ transcription: reply });
          },
        }),
      ),
    ),
  );

it.effect(
  "rewrites the draft on the project's text model and keeps the draft on an empty reply",
  () =>
    Effect.gen(function* () {
      const calls: Array<{ prompt: string; modelSelection: ModelSelection }> = [];
      const rewritten = yield* PromptPolish.PromptPolish.pipe(
        Effect.flatMap((service) => service.polish({ prompt: "fix teh login bug", projectId })),
        Effect.provide(run("  Fix the login bug.\n", calls)),
      );
      expect(rewritten).toEqual({ prompt: "Fix the login bug." });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.prompt).toContain("<draft>\nfix teh login bug\n</draft>");
      expect(calls[0]!.modelSelection).toEqual(projectModel);

      const kept = yield* PromptPolish.PromptPolish.pipe(
        Effect.flatMap((service) => service.polish({ prompt: "fix teh login bug" })),
        Effect.provide(run("   ", calls)),
      );
      expect(kept).toEqual({ prompt: "fix teh login bug" });
      expect(calls[1]!.modelSelection).toEqual(
        DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
      );

      const blank = yield* PromptPolish.PromptPolish.pipe(
        Effect.flatMap((service) => service.polish({ prompt: "  " })),
        Effect.provide(run("unused", calls)),
      );
      expect(blank).toEqual({ prompt: "  " });
      expect(calls).toHaveLength(2);
    }),
);
