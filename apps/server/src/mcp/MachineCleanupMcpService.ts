import {
  MachineCleanupError,
  type MachineCleanupAgentInput,
  type MachineCleanupState,
  type OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MachineCleanup from "../MachineCleanupService.ts";
import * as ThreadMetadata from "./ThreadMetadataMcpService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

export class MachineCleanupMcpService extends Context.Service<
  MachineCleanupMcpService,
  {
    readonly execute: (
      scope: McpInvocationScope,
      input: typeof MachineCleanupAgentInput.Type,
    ) => Effect.Effect<MachineCleanupState, MachineCleanupError | OrchestratorMcpFailure>;
  }
>()("t3/mcp/MachineCleanupMcpService") {}

const make = Effect.gen(function* () {
  const cleanup = yield* MachineCleanup.MachineCleanup;
  const metadata = yield* ThreadMetadata.ThreadMetadataMcpService;
  const execute = Effect.fn("MachineCleanupMcpService.execute")(function* (
    scope: McpInvocationScope,
    input: typeof MachineCleanupAgentInput.Type,
  ) {
    if (input.action === "scan") yield* cleanup.scan;
    if (input.action === "phaseA") yield* cleanup.runPhaseA;
    if (input.action === "requestApproval") {
      const state = yield* cleanup.current;
      const phase = input.phase ?? "B";
      if (
        state.running ||
        !state.report?.items.some((item) => item.phase === phase && item.outcome === "pending")
      )
        return yield* new MachineCleanupError({
          operation: "approval-request",
          cause: "Complete a scan with pending candidates first",
        });
      yield* metadata.openQuestions(scope, {
        action: "declare",
        questions: [
          {
            id: "machine-cleanup",
            context: "Cleanup found items that require your explicit review.",
            text: `Review Phase ${phase} candidates in [Machine cleanup](/settings/maintenance). Only confirming exact paths there approves deletion. A reply here does not approve deletion.`,
            suggestions: ["Review in Settings", "Keep everything"],
            recommended: "Keep everything",
          },
        ],
      });
    }
    const state = yield* cleanup.current;
    return { ...state, history: [] };
  });
  return MachineCleanupMcpService.of({ execute });
});
export const layer = Layer.effect(MachineCleanupMcpService, make);
