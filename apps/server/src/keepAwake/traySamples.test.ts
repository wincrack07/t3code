import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { traySamples } from "./traySamples.ts";

it.effect("subscribes only while enabled and releases on disable and shutdown", () =>
  Effect.gen(function* () {
    const enabled = yield* Queue.unbounded<boolean>();
    const frames = yield* Queue.unbounded<number | undefined>();
    let acquisitions = 0;
    let active = 0;
    const samples = Stream.unwrap(
      Effect.acquireRelease(
        Effect.sync(() => {
          acquisitions++;
          active++;
          return Stream.concat(Stream.make(1), Stream.never);
        }),
        () =>
          Effect.sync(() => {
            active--;
          }),
      ),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* traySamples(Stream.fromQueue(enabled), samples).pipe(
          Stream.runForEach((frame) => Queue.offer(frames, frame)),
          Effect.forkScoped,
        );
        yield* Queue.offer(enabled, false);
        yield* Queue.take(frames);
        expect(active).toBe(0);
        yield* Queue.offer(enabled, true);
        yield* Queue.take(frames);
        expect(active).toBe(1);
        yield* Queue.offer(enabled, true);
        yield* Queue.offer(enabled, false);
        yield* Queue.take(frames);
        expect(acquisitions).toBe(1);
        expect(active).toBe(0);
        yield* Queue.offer(enabled, true);
        yield* Queue.take(frames);
        expect(active).toBe(1);
      }),
    );
    expect(active).toBe(0);
  }),
);
