import {
  PROMPT_POLISH_INSTRUCTIONS,
  TextGenerationError,
  type PromptPolishInput,
  type PromptPolishResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export class PromptPolish extends Context.Service<
  PromptPolish,
  {
    readonly polish: (
      input: PromptPolishInput,
    ) => Effect.Effect<PromptPolishResult, TextGenerationError>;
  }
>()("t3/promptPolish/PromptPolish") {}

const isTextGenerationError = Schema.is(TextGenerationError);

export function buildPromptPolishPrompt(draft: string): string {
  return `${PROMPT_POLISH_INSTRUCTIONS}

<draft>
${draft}
</draft>`;
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration.TextGeneration;
  return PromptPolish.of({
    polish: Effect.fn("PromptPolish.polish")(
      function* (input) {
        if (input.prompt.trim().length === 0) return { prompt: input.prompt };
        const settings = resolveProjectSettings(
          yield* settingsService.getSettings,
          input.projectId ?? null,
        ).settings;
        // Providers run in a working directory; a rewrite must not read a checkout.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-prompt-polish-" });
        // Providers expose one free-form text operation, named for its first use.
        const generated = yield* textGeneration.generateTranscriptionPostProcessing({
          cwd,
          prompt: buildPromptPolishPrompt(input.prompt),
          modelSelection: settings.textGenerationModelSelection,
        });
        const prompt = generated.transcription.trim();
        return { prompt: prompt.length > 0 ? prompt : input.prompt };
      },
      Effect.scoped,
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: "polishPrompt",
              detail: "Could not prepare the prompt rewrite.",
              cause,
            }),
      ),
    ),
  });
});

export const layer = Layer.effect(PromptPolish, make);
