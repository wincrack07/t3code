import * as Stream from "effect/Stream";

export function traySamples<A>(enabled: Stream.Stream<boolean>, samples: Stream.Stream<A>) {
  return enabled.pipe(
    Stream.changes,
    Stream.switchMap((on): Stream.Stream<A | undefined> => (on ? samples : Stream.make(undefined))),
  );
}
