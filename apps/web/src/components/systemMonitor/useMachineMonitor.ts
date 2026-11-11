import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";

/** `detail` adds the process list and project attribution, which cost the host a /proc scan. */
export function useMachineMonitor(id: EnvironmentId | null, detail: boolean) {
  const allowed = useEnvironmentScope(id, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    id && allowed
      ? serverEnvironment.machineMonitor({ environmentId: id, input: { detail } })
      : null,
  );
  return { ...query, allowed };
}
