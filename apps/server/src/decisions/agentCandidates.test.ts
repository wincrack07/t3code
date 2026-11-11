import { expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestratorMcpProviderCapability,
} from "@t3tools/contracts";
import { peerDecisionCandidates } from "./agentCandidates.ts";

it("uses only runnable peer capabilities and preserves their node, project and allowed efforts", () => {
  const provider: OrchestratorMcpProviderCapability = {
    providerInstanceId: ProviderInstanceId.make("personal"),
    driverKind: ProviderDriverKind.make("codex"),
    displayName: "Personal",
    canRunChildTask: true,
    canRunCrossProviderChildTask: true,
    constraints: [],
    models: [{ id: "fast", options: [{ id: "reasoningEffort", values: ["low", "high"] }] }],
  };
  expect(peerDecisionCandidates("linux", "remote-project", [provider])).toEqual(
    ["low", "high"].map((effort) => ({
      environmentId: "linux",
      projectId: "remote-project",
      providerInstanceId: "personal",
      driver: "codex",
      model: "fast",
      effort,
      effortOptionId: "reasoningEffort",
    })),
  );
  expect(
    peerDecisionCandidates("linux", "remote-project", [
      { ...provider, constraints: ["Not authenticated"] },
    ]),
  ).toEqual([]);
  expect(
    peerDecisionCandidates("linux", "remote-project", [{ ...provider, canRunChildTask: false }]),
  ).toEqual([]);
});
