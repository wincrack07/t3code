import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type ForkFeatureId, isForkFeatureOn } from "@t3tools/contracts";

import { environmentPresentations } from "./presentation";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";

/**
 * Whether a fork feature is on in an environment's server settings. Without an environment it
 * asks the primary one, which owns app-wide entry points such as sidebar items.
 */
export function useForkFeature(
  feature: ForkFeatureId,
  environmentId?: EnvironmentId | null,
): boolean {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const target = environmentId ?? primaryEnvironmentId;
  return useAtomValue(environmentPresentations.serverConfigsAtom, (configs) =>
    isForkFeatureOn(target ? configs.get(target)?.settings.forkFeatures : undefined, feature),
  );
}

/** The same answer outside React, for menus built in event handlers. */
export function readForkFeature(feature: ForkFeatureId, environmentId?: EnvironmentId | null) {
  const target = environmentId ?? appAtomRegistry.get(primaryEnvironmentIdAtom);
  const configs = appAtomRegistry.get(environmentPresentations.serverConfigsAtom);
  return isForkFeatureOn(target ? configs.get(target)?.settings.forkFeatures : undefined, feature);
}
