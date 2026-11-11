import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import {
  AUTO_MODEL,
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  EnvironmentId,
  ProjectId,
  ServerProvider,
  type DecisionCandidate,
  type DecisionSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SystemMonitor from "../systemMonitor/SystemMonitor.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Decisions from "./Decisions.ts";
import { mapSettingsSecrets, SECRET_REDACTED } from "../settingsSecrets.ts";

const input = { projectId: ProjectId.make("app"), prompt: "Fix typo" };
const provider = Schema.decodeSync(ServerProvider)({
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00Z",
  models: [
    { slug: "fast", name: "Fast", isCustom: false, capabilities: {} },
    { slug: "other", name: "Other", isCustom: false, capabilities: {} },
  ],
});
const project = Schema.decodeSync(ProjectStore.ProjectRow)({
  projectId: "app",
  title: "App",
  workspaceRoot: "/home/user/app",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
});
const choice: DecisionCandidate = {
  providerInstanceId: "codex",
  driver: "codex",
  model: "fast",
  effort: null,
  effortOptionId: null,
  environmentId: "local",
  projectId: "app",
};
const config: DecisionSettings = { ...DEFAULT_SERVER_SETTINGS.decisions, enabled: true };
const fixture = (config: DecisionSettings, answer: string, calls: string[]) =>
  Decisions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeedSome(project),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, decisions: config }),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("local")),
        }),
        Layer.mock(SystemMonitor.SystemMonitor)({
          current: Effect.succeed({
            sample: {
              at: 0,
              cpu: 0,
              pressure: "normal",
              memoryAvailable: 1000,
              memoryUsed: 0,
              memoryTotal: 1000,
              swapUsed: null,
              swapTotal: null,
              diskFree: null,
              diskTotal: null,
              networkDown: null,
              networkUp: null,
              load: [],
              uptime: 0,
            },
            history: [],
            limitations: [],
          }),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: (request) => {
            calls.push(request.prompt);
            return Effect.succeed({ transcription: answer });
          },
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected API request")),
        ),
      ),
    ),
  );

it.effect("honors explicit choices before settings and caches valid answers", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    yield* Effect.gen(function* () {
      const service = yield* Decisions.Decisions;
      expect((yield* service.decide(input, choice)).source).toBe("explicit");
      expect(calls).toEqual([]);
      expect((yield* service.decide(input)).choice?.model).toBe("other");
      yield* service.decide(input);
      const routed = yield* service.route(input, {
        instanceId: ProviderInstanceId.make("codex"),
        model: AUTO_MODEL,
      });
      expect(routed.modelSelection).toEqual({
        instanceId: "codex",
        model: "other",
        routing: "auto",
      });
      expect(routed.routingDecision?.reason).toBe("Suitable");
      const manual = { instanceId: ProviderInstanceId.make("codex"), model: "fast" };
      expect((yield* service.route(input, manual)).modelSelection).toEqual(manual);
      expect(calls).toHaveLength(1);
    }).pipe(Effect.provide(fixture(config, '{"candidate":1,"reason":"Suitable"}', calls)));
  }),
);

it.effect("falls back on an invalid answer and never calls a model for a deciding rule", () =>
  Effect.gen(function* () {
    const invalid = yield* Decisions.Decisions.pipe(
      Effect.flatMap((service) => service.decide(input)),
      Effect.provide(fixture(config, '{"candidate":99,"reason":"Invented"}', [])),
    );
    expect(invalid.source).toBe("fallback");
    expect(invalid.choice).toBeNull();
    const calls: string[] = [];
    const ruled = yield* Decisions.Decisions.pipe(
      Effect.flatMap((service) => service.decide(input)),
      Effect.provide(
        fixture(
          {
            ...config,
            rules: [
              {
                id: "pin",
                name: "Pin fast",
                enabled: true,
                when: {},
                choose: { models: ["fast"] },
                action: "decide",
              },
            ],
          },
          "unused",
          calls,
        ),
      ),
    );
    expect(ruled.source).toBe("rule");
    expect(ruled.choice?.model).toBe("fast");
    expect(calls).toEqual([]);
  }),
);

it.effect("keeps the decision API credential in the existing secret mapping", () =>
  Effect.sync(() => {
    const seen: string[] = [];
    const client = mapSettingsSecrets(
      { ...DEFAULT_SERVER_SETTINGS, decisions: { ...config, apiKey: "fake-decision-key" } },
      (secret) => {
        if (secret.secretName === "decisions-apiKey") seen.push(secret.value);
        return { value: SECRET_REDACTED, redacted: true };
      },
    );
    expect(seen).toEqual(["fake-decision-key"]);
    expect(JSON.stringify(client)).not.toContain("fake-decision-key");
    expect(client.decisions.apiKey).toBe(SECRET_REDACTED);
  }),
);
