import {
  AUTO_MODEL,
  ProviderInstanceId,
  ProjectId,
  type ModelSelection,
  type DecisionCandidate,
  type DecisionInput,
  type DecisionResult,
  isProviderTextGenerationCapable,
} from "@t3tools/contracts";
import { applyDecisionRules } from "@t3tools/shared/decisionRules";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { defaultTextGenerationModel } from "@t3tools/shared/serverSettings";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { HttpClient, HttpClientError } from "effect/http";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SystemMonitor from "../systemMonitor/SystemMonitor.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { decisionCandidates } from "./candidates.ts";
import { decisionPrompt, parseDecisionAnswer } from "./prompt.ts";
import { requestJevDecision } from "./jev.ts";
import { requestOpenAiDecision } from "./openai.ts";

export class Decisions extends Context.Service<
  Decisions,
  {
    readonly testConnection: () => Effect.Effect<{ success: boolean; message: string }>;
    readonly route: (
      input: DecisionInput,
      selection: ModelSelection,
    ) => Effect.Effect<{ modelSelection: ModelSelection; routingDecision?: DecisionResult }>;
    readonly decide: (
      input: DecisionInput,
      explicit?: DecisionCandidate,
    ) => Effect.Effect<DecisionResult>;
  }
>()("t3/decisions/Decisions") {}

const decisionCacheKey = (value: unknown) => JSON.stringify(value);

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const monitor = yield* SystemMonitor.SystemMonitor;
  const text = yield* TextGeneration.TextGeneration;
  const fs = yield* FileSystem.FileSystem;
  const http = yield* HttpClient.HttpClient;
  let previousApiKey: unknown;
  let previousCustomApiKey: unknown;
  let previousJevApiKey: unknown;
  const cache = new Map<string, { at: number; result: DecisionResult }>();
  const decide = Effect.fn("Decisions.decide")(function* (
    input: DecisionInput,
    explicit?: DecisionCandidate,
  ) {
    const fallback = (reason: string, ruleIds: ReadonlyArray<string> = []): DecisionResult => ({
      choice: null,
      reason,
      source: "fallback",
      ruleIds,
    });
    if (explicit)
      return {
        choice: explicit,
        reason: "Explicit target",
        source: "explicit",
        ruleIds: [],
      } satisfies DecisionResult;
    const settings = yield* settingsService.getSettings;
    const config = settings.decisions;
    if (
      previousApiKey !== config.apiKey ||
      previousCustomApiKey !== config.customApiKey ||
      previousJevApiKey !== config.jevApiKey
    ) {
      cache.clear();
      previousJevApiKey = config.jevApiKey;
      previousApiKey = config.apiKey;
      previousCustomApiKey = config.customApiKey;
    }
    if (!config.enabled) return fallback("Decisions is disabled; using normal defaults.");
    const project = yield* projects.get(input.projectId);
    if (Option.isNone(project)) return fallback("Project is unavailable; using normal defaults.");
    const environmentId = yield* environment.getEnvironmentId;
    const providers = yield* registry.getProviders;
    const now = yield* Clock.currentTimeMillis;
    const candidates = decisionCandidates(
      [{ environmentId, projectId: input.projectId, reachable: true, hasProject: true, providers }],
      settings,
      input.projectId,
      now,
      config.allowedEnvironmentIds ?? undefined,
      config.allowedProviderInstanceIds ?? undefined,
    );
    const filtered = applyDecisionRules(config.rules, input, candidates);
    if (filtered.candidates.length === 0)
      return fallback(
        "No usable option matches the routing rules; using normal defaults.",
        filtered.ruleIds,
      );
    if (filtered.decided || filtered.candidates.length === 1)
      return {
        choice: filtered.candidates[0]!,
        reason: filtered.decided
          ? `Rule: ${
              config.rules
                .find((rule) => rule.id === filtered.ruleIds.at(-1))
                ?.name.replace(/\s+/g, " ")
                .slice(0, 220) ?? "Routing rule"
            }`
          : "Only one usable option remains.",
        source: filtered.decided ? "rule" : "single",
        ruleIds: filtered.ruleIds,
      } satisfies DecisionResult;
    const sample = (yield* monitor.current).sample;
    const load = {
      environmentId,
      cpu: sample.cpu,
      pressure: sample.pressure,
      memoryAvailable: sample.memoryAvailable,
    };
    const modelCandidates = filtered.candidates.slice(0, 64);
    const prompt = decisionPrompt(input, modelCandidates, load);
    const key = decisionCacheKey([
      input,
      modelCandidates,
      environmentId,
      sample.pressure,
      config.source,
      config.modelSelection,
      config.openaiModel,
      config.jevModel,
      config.customBaseUrl,
      config.customModel,
      config.rules,
    ]);
    const cached = cache.get(key);
    if (cached && now - cached.at < 15_000) return cached.result;
    const generate = Effect.gen(function* () {
      if (config.source === "jev") {
        if (typeof config.jevApiKey !== "string" || !config.jevApiKey)
          return yield* Effect.fail("Decision API key is missing");
        return yield* requestJevDecision(
          config.jevApiKey,
          config.jevModel ?? "jev-latest",
          input,
          modelCandidates,
          load,
        ).pipe(Effect.provideService(HttpClient.HttpClient, http));
      }
      if (config.source !== "provider") {
        if (config.source === "custom" && (!config.customBaseUrl || !config.customModel))
          return yield* Effect.fail("Decision base URL or model is missing");
        const apiKey = config.source === "custom" ? config.customApiKey : config.apiKey;
        if (typeof apiKey !== "string" || !apiKey)
          return yield* Effect.fail("Decision API key is missing");
        return yield* requestOpenAiDecision(
          apiKey,
          config.source === "custom" ? (config.customModel ?? "") : config.openaiModel,
          prompt,
          config.source === "custom" ? config.customBaseUrl : undefined,
        ).pipe(Effect.provideService(HttpClient.HttpClient, http));
      }
      const provider = providers.find(
        (candidate) =>
          candidates.some((option) => option.providerInstanceId === candidate.instanceId) &&
          isProviderTextGenerationCapable(candidate),
      );
      if (!provider) return yield* Effect.fail("No decision provider available");
      const modelSelection = config.modelSelection ?? {
        instanceId: provider.instanceId,
        model:
          provider.models.find(
            (model) => model.slug === defaultTextGenerationModel(provider.driver),
          )?.slug ?? provider.models[0]!.slug,
      };
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-decisions-" });
      const generated = yield* text.generateTranscriptionPostProcessing({
        cwd,
        prompt,
        modelSelection,
      });
      return generated.transcription;
    }).pipe(Effect.scoped);
    const answer = yield* generate.pipe(Effect.timeout("4 seconds"), Effect.option);
    const parsed =
      answer._tag === "Some" ? parseDecisionAnswer(answer.value, modelCandidates) : undefined;
    if (!parsed)
      return fallback(
        "Decision failed or returned an invalid option; using normal defaults.",
        filtered.ruleIds,
      );
    const result: DecisionResult = { ...parsed, source: "model", ruleIds: filtered.ruleIds };
    if (cache.size >= 64) cache.clear();
    cache.set(key, { at: now, result });
    return result;
  });
  const route = Effect.fn("Decisions.route")(function* (
    input: DecisionInput,
    selection: ModelSelection,
  ) {
    if (selection.model !== AUTO_MODEL && selection.routing !== "auto")
      return { modelSelection: selection };
    let fallback = selection;
    if (selection.model === AUTO_MODEL) {
      const settings = resolveProjectSettings(
        yield* settingsService.getSettings,
        input.projectId,
      ).settings;
      const project = yield* projects.get(input.projectId);
      fallback =
        resolveNewThreadModelSelection({
          defaultSelection: Option.isSome(project)
            ? (project.value.defaultModelSelection ?? settings.defaultModelSelection)
            : settings.defaultModelSelection,
          fallbackSelection: settings.fallbackModelSelection,
          providers: yield* registry.getProviders,
          settings,
          projectId: input.projectId,
          now: yield* Clock.currentTimeMillis,
        }).selection ?? settings.textGenerationModelSelection;
      if (fallback.model === AUTO_MODEL) fallback = settings.textGenerationModelSelection;
    }
    const decision = yield* decide(input).pipe(
      Effect.orElseSucceed(() => ({
        choice: null,
        reason: "Decision unavailable; using normal defaults.",
        source: "fallback" as const,
        ruleIds: [],
      })),
    );
    const choice = decision.choice;
    const modelSelection: ModelSelection = choice
      ? {
          instanceId: ProviderInstanceId.make(choice.providerInstanceId),
          model: choice.model,
          ...(choice.effort !== null && choice.effortOptionId !== null
            ? { options: [{ id: choice.effortOptionId, value: choice.effort }] }
            : {}),
          routing: "auto",
        }
      : { ...fallback, routing: "auto" };
    return { modelSelection, routingDecision: decision };
  });
  const testConnection = Effect.fn("Decisions.testConnection")(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.option);
    if (Option.isNone(settings))
      return { success: false, message: "Could not read decision settings." };
    const config = settings.value.decisions;
    const custom = config.source === "custom";
    const apiKey =
      config.source === "jev" ? config.jevApiKey : custom ? config.customApiKey : config.apiKey;
    if (config.source === "provider")
      return { success: false, message: "Select an API decision source first." };
    if (typeof apiKey !== "string" || !apiKey)
      return { success: false, message: "Decision API key is missing." };
    if (custom && (!config.customBaseUrl || !config.customModel))
      return { success: false, message: "Enter a base URL and model first." };
    const candidate: DecisionCandidate = {
      providerInstanceId: "test",
      driver: "test",
      model: "test",
      effort: null,
      effortOptionId: null,
      environmentId: "test",
      projectId: "test",
    };
    const request =
      config.source === "jev"
        ? requestJevDecision(
            apiKey,
            config.jevModel ?? "jev-latest",
            { projectId: ProjectId.make("test"), prompt: "Test decision connection" },
            [candidate],
            {},
          )
        : requestOpenAiDecision(
            apiKey,
            custom ? config.customModel! : config.openaiModel,
            'Return {"candidate":0,"reason":"Connection successful"}.',
            custom ? config.customBaseUrl : undefined,
          );
    return yield* request.pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.timeout("4 seconds"),
      Effect.map((answer) => {
        const valid = parseDecisionAnswer(answer, [candidate]) !== undefined;
        return {
          success: valid,
          message: valid ? "Connection successful." : "Decision API returned an invalid answer.",
        };
      }),
      Effect.catch((error) =>
        Effect.succeed({
          success: false,
          message:
            typeof error === "string"
              ? error
              : typeof error === "object" &&
                  error !== null &&
                  "_tag" in error &&
                  error._tag === "TimeoutError"
                ? "Decision API timed out after 4 seconds."
                : HttpClientError.isHttpClientError(error)
                  ? `Decision API request failed (${error.reason._tag}).`
                  : "Decision API returned an invalid response.",
        }),
      ),
    );
  });
  return Decisions.of({
    testConnection,
    route: Effect.fn("Decisions.safeRoute")((input, selection) =>
      route(input, selection).pipe(
        Effect.orElseSucceed(() => ({
          modelSelection:
            selection.model === AUTO_MODEL
              ? { instanceId: selection.instanceId, model: "default", routing: "auto" as const }
              : selection,
        })),
      ),
    ),
    decide: Effect.fn("Decisions.safeDecide")((input, explicit) =>
      decide(input, explicit).pipe(
        Effect.orElseSucceed(() => ({
          choice: null,
          reason: "Decision unavailable; using normal defaults.",
          source: "fallback" as const,
          ruleIds: [],
        })),
      ),
    ),
  });
});

export const layer = Layer.effect(Decisions, make);
