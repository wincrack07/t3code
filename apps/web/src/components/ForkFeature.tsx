import type { EnvironmentId, ForkFeatureId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useForkFeature } from "../state/forkFeatures";

/** Renders its children only while the fork feature is on. */
export function ForkFeature(props: {
  id: ForkFeatureId;
  environmentId?: EnvironmentId | null;
  children: ReactNode;
}) {
  return useForkFeature(props.id, props.environmentId) ? props.children : null;
}
