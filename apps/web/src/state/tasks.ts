import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const launchTaskThread = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:tasks:launch",
  tag: ORCHESTRATION_V2_WS_METHODS.launchThread,
});
