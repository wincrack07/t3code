import {
  isProviderAvailable,
  resolveProjectProviderInstanceEnabled,
  type DecisionCandidate,
  type ServerProvider,
  type ServerSettings,
  type ProjectId,
} from "@t3tools/contracts";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";

export interface DecisionEnvironment {
  readonly environmentId: string;
  readonly projectId: string;
  readonly reachable: boolean;
  readonly hasProject: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
}

export function decisionCandidates(
  environments: ReadonlyArray<DecisionEnvironment>,
  settings: ServerSettings,
  projectId: ProjectId,
  now: number,
  allowedEnvironments?: ReadonlyArray<string>,
  allowedInstances?: ReadonlyArray<string>,
): DecisionCandidate[] {
  return environments.flatMap((environment) => {
    if (
      !environment.reachable ||
      !environment.hasProject ||
      (allowedEnvironments !== undefined &&
        !allowedEnvironments.includes(environment.environmentId))
    )
      return [];
    return environment.providers.flatMap((provider) => {
      if (
        !provider.enabled ||
        !provider.installed ||
        provider.status === "error" ||
        provider.auth.status === "unauthenticated" ||
        !isProviderAvailable(provider) ||
        (allowedInstances !== undefined && !allowedInstances.includes(provider.instanceId)) ||
        !resolveProjectProviderInstanceEnabled(settings, projectId, provider.instanceId)
      )
        return [];
      return provider.models.flatMap((model) => {
        if (exhaustedUsageWindow(provider, now, model.slug)) return [];
        const descriptor = model.capabilities?.optionDescriptors?.find(
          (option) =>
            option.type === "select" &&
            (option.role === "reasoning" || option.id === "reasoningEffort"),
        );
        const efforts =
          descriptor?.type === "select" ? descriptor.options.map((option) => option.id) : [null];
        return efforts.map((effort) => ({
          providerInstanceId: provider.instanceId,
          driver: provider.driver,
          model: model.slug,
          effort,
          effortOptionId: descriptor?.id ?? null,
          environmentId: environment.environmentId,
          projectId: environment.projectId,
        }));
      });
    });
  });
}
