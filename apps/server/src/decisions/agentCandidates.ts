import {
  OrchestratorMcpCapabilitiesInput,
  OrchestratorMcpCapabilitiesResult,
  OrchestratorMcpFailure,
  Project,
  MachineMonitorSnapshot,
  type DecisionCandidate,
  type OrchestratorMcpProviderCapability,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";

export const peerCapabilities = Tool.make("orchestrator_capabilities", {
  parameters: OrchestratorMcpCapabilitiesInput,
  success: OrchestratorMcpCapabilitiesResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
});
export const peerProjects = Tool.make("t3_project_list", {
  parameters: Schema.Struct({ cursor: Schema.Number, limit: Schema.Number }),
  success: Schema.Struct({
    projects: Schema.Array(Project),
    nextCursor: Schema.NullOr(Schema.Number),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
});
export const peerMachine = Tool.make("t3_environment_read", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({ machine: MachineMonitorSnapshot }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
});

export function peerDecisionCandidates(
  environmentId: string,
  projectId: string,
  providers: ReadonlyArray<OrchestratorMcpProviderCapability>,
): DecisionCandidate[] {
  return providers.flatMap((provider) =>
    !provider.canRunChildTask || provider.constraints.length
      ? []
      : provider.models.flatMap((model) => {
          const effort = model.options?.find(
            (option) =>
              /effort|reason|think|thought/i.test(option.id) &&
              option.values.every((value) => typeof value === "string"),
          );
          const values = effort
            ? effort.values.filter((value): value is string => typeof value === "string")
            : [null];
          return values.map((value) => ({
            environmentId,
            projectId,
            providerInstanceId: provider.providerInstanceId,
            driver: provider.driverKind,
            model: model.id,
            effort: value,
            effortOptionId: effort?.id ?? null,
          }));
        }),
  );
}
