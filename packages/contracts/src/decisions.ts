import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";
import { SettingsSecretValue } from "./settingsSecretValue.ts";
import { ProjectId } from "./baseSchemas.ts";

const DecisionRole = Schema.Literals([
  "implementation",
  "research",
  "review",
  "design",
  "test",
  "general",
]);

const Names = Schema.Array(Schema.String);
export const DecisionRule = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  when: Schema.Struct({
    projectIds: Schema.optional(Names),
    roles: Schema.optional(Schema.Array(DecisionRole)),
    authorDrivers: Schema.optional(Names),
    authorInstanceIds: Schema.optional(Names),
  }),
  choose: Schema.Struct({
    providerInstanceIds: Schema.optional(Names),
    drivers: Schema.optional(Names),
    models: Schema.optional(Names),
    efforts: Schema.optional(Names),
    environmentIds: Schema.optional(Names),
  }),
  action: Schema.Literals(["restrict", "decide"]),
});
export type DecisionRule = typeof DecisionRule.Type;

export const DecisionContext = Schema.Struct({
  projectId: Schema.String,
  role: Schema.optional(DecisionRole),
  authorDriver: Schema.optional(Schema.String),
  authorInstanceId: Schema.optional(Schema.String),
});
export type DecisionContext = typeof DecisionContext.Type;

export const DecisionCandidate = Schema.Struct({
  providerInstanceId: Schema.String,
  driver: Schema.String,
  model: Schema.String,
  effort: Schema.NullOr(Schema.String),
  effortOptionId: Schema.NullOr(Schema.String),
  environmentId: Schema.String,
  projectId: Schema.String,
});
export type DecisionCandidate = typeof DecisionCandidate.Type;

export const DecisionResult = Schema.Struct({
  choice: Schema.NullOr(DecisionCandidate),
  reason: Schema.String,
  source: Schema.Literals(["explicit", "rule", "single", "model", "fallback"]),
  ruleIds: Names,
});
export type DecisionResult = typeof DecisionResult.Type;

const DecisionBaseUrl = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      if (value === "") return true;
      try {
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash) return false;
        const host = url.hostname;
        const octets = host.split(".").map(Number);
        const local =
          host === "localhost" ||
          host.endsWith(".localhost") ||
          host === "[::1]" ||
          (octets.length === 4 && octets[0] === 127);
        const tailnet =
          host.endsWith(".ts.net") ||
          (octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) ||
          host.startsWith("[fd7a:115c:a1e0:");
        return url.protocol === "https:" || (url.protocol === "http:" && (local || tailnet));
      } catch {
        return false;
      }
    },
    {
      message:
        "Use HTTPS, or HTTP on loopback or a tailnet, without credentials, query or fragment.",
    },
  ),
);

export const DecisionSettings = Schema.Struct({
  enabled: Schema.Boolean,
  source: Schema.Literals(["provider", "openai", "custom"]),
  customBaseUrl: Schema.optional(DecisionBaseUrl),
  customModel: Schema.optional(Schema.String),
  customApiKey: Schema.optional(SettingsSecretValue).pipe(
    Schema.annotateKey({ settingsSecret: true, settingsSecretReference: true }),
  ),
  modelSelection: Schema.NullOr(ModelSelection),
  openaiModel: Schema.String,
  apiKey: SettingsSecretValue,
  rules: Schema.Array(DecisionRule),
  allowedEnvironmentIds: Schema.NullOr(Names),
  allowedProviderInstanceIds: Schema.NullOr(Names),
});
export type DecisionSettings = typeof DecisionSettings.Type;
export const DEFAULT_DECISION_SETTINGS: DecisionSettings = {
  enabled: false,
  source: "provider",
  customBaseUrl: "",
  customModel: "",
  customApiKey: "",
  modelSelection: null,
  openaiModel: "gpt-4.1-nano",
  apiKey: "",
  rules: [],
  allowedEnvironmentIds: null,
  allowedProviderInstanceIds: null,
};
export const DecisionInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(100_000)),
  projectId: ProjectId,
  role: Schema.optional(DecisionRole),
  authorDriver: Schema.optional(Schema.String),
  authorInstanceId: Schema.optional(Schema.String),
});
export type DecisionInput = typeof DecisionInput.Type;

export const AUTO_MODEL = "t3:auto";
