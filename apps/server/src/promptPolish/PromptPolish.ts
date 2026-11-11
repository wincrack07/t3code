import {
  DEFAULT_PROMPT_POLISH_SETTINGS,
  isProviderAvailable,
  isProviderTextGenerationCapable,
  resolveProjectProviderInstanceEnabled,
  type PromptPolishSettings,
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

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
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

export function buildPromptPolishPrompt(
  draft: string,
  settings: PromptPolishSettings = DEFAULT_PROMPT_POLISH_SETTINGS,
): string {
  const rules = settings.rules
    .filter((rule) => rule.enabled)
    .map((rule) => rule.text)
    .join(" ");
  const instructions = [settings.basePrompt, rules].filter(Boolean).join("\n\n");
  return `${instructions}

<draft>
${draft}
</draft>`;
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const textGeneration = yield* TextGeneration.TextGeneration;
  return PromptPolish.of({
    polish: Effect.fn("PromptPolish.polish")(
      function* (input) {
        if (input.prompt.trim().length === 0) return { prompt: input.prompt };
        const settings = resolveProjectSettings(
          yield* settingsService.getSettings,
          input.projectId ?? null,
        ).settings;
        const override = settings.promptPolish.modelSelection;
        const provider = override
          ? (yield* registry.getProviders).find(
              (provider) => provider.instanceId === override.instanceId,
            )
          : undefined;
        const modelSelection =
          override &&
          provider &&
          provider.enabled &&
          provider.installed &&
          provider.status !== "error" &&
          provider.auth.status !== "unauthenticated" &&
          isProviderAvailable(provider) &&
          isProviderTextGenerationCapable(provider) &&
          resolveProjectProviderInstanceEnabled(
            settings,
            input.projectId ?? null,
            provider.instanceId,
          ) &&
          provider.models.some((model) => model.slug === override.model)
            ? override
            : settings.textGenerationModelSelection;
        // Providers run in a working directory; a rewrite must not read a checkout.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-prompt-polish-" });
        // Providers expose one free-form text operation, named for its first use.
        const generated = yield* textGeneration.generateTranscriptionPostProcessing({
          cwd,
          prompt: buildPromptPolishPrompt(input.prompt, settings.promptPolish),
          modelSelection,
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
