import { type ForkFeatureId, isForkFeatureOn } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSettings from "./serverSettings.ts";

/** Whether a fork feature is on in this environment's settings. Unreadable settings count as on. */
const forkFeatureOn = Effect.fn("ForkFeatures.isOn")(function* (feature: ForkFeatureId) {
  const settings = yield* ServerSettings.ServerSettingsService;
  const current = yield* settings.getSettings.pipe(Effect.option);
  return isForkFeatureOn(Option.getOrUndefined(current)?.forkFeatures, feature);
});

/** Runs the effect only while the feature is on, for background loops that tick regardless. */
export const whileForkFeatureOn =
  (feature: ForkFeatureId) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    forkFeatureOn(feature).pipe(Effect.flatMap((on) => (on ? Effect.asVoid(effect) : Effect.void)));
