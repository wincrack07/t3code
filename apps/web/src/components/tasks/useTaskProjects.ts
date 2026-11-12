import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentId } from "@t3tools/contracts";

import { useClientSettings } from "../../hooks/useSettings";
import { useProjects } from "../../state/entities";
import {
  useConnectedEnvironmentIds,
  useEnvironmentIdentities,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { buildTaskProjectGroups } from "./tasks.logic";

/** Every logical project's tasks, read from the project streams the client already holds. */
export function useTaskProjectGroups() {
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  return buildTaskProjectGroups({
    projects,
    settings,
    primaryEnvironmentId,
    connected: new Set(connected),
  });
}

export function useEnvironmentLabel() {
  const identities = useEnvironmentIdentities();
  const labels = new Map(identities.map((entry) => [entry.environmentId, entry.label] as const));
  return (environmentId: EnvironmentId) => labels.get(environmentId) ?? environmentId;
}
