import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as MachineSampler from "./MachineSampler.ts";
import * as SystemMonitor from "./SystemMonitor.ts";

it.effect("shares sampling, waits between samples and stops when the last subscriber closes", () =>
  Effect.gen(function* () {
    const samples = yield* Queue.unbounded<number>();
    let count = 0;
    const sample = Effect.gen(function* () {
      count++;
      yield* Queue.offer(samples, count);
      return {
        sample: {
          at: yield* Clock.currentTimeMillis,
          cpu: null,
          memoryUsed: 1,
          memoryAvailable: 1,
          memoryTotal: 2,
          pressure: "normal" as const,
          swapUsed: 0,
          swapTotal: 0,
          diskFree: 1,
          diskTotal: 2,
          networkDown: null,
          networkUp: null,
          load: [0, 0, 0],
          uptime: 1,
        },
        projects: [],
        processesAt: 0,
        topMemory: [],
        topCpu: [],
        limitations: [],
      };
    });
    yield* Effect.gen(function* () {
      const monitor = yield* SystemMonitor.SystemMonitor;
      expect(count).toBe(0);
      const one = yield* Scope.make();
      yield* monitor.stream.pipe(Stream.runDrain, Effect.forkIn(one));
      expect(yield* Queue.take(samples)).toBe(1);
      const two = yield* Scope.make();
      yield* monitor.stream.pipe(Stream.runDrain, Effect.forkIn(two));
      yield* TestClock.adjust("2 seconds");
      expect(yield* Queue.take(samples)).toBe(2);
      yield* Scope.close(one, Exit.void);
      yield* TestClock.adjust("2 seconds");
      expect(yield* Queue.take(samples)).toBe(3);
      yield* Scope.close(two, Exit.void);
      yield* TestClock.adjust("20 seconds");
      expect(count).toBe(3);
    }).pipe(
      Effect.provide(
        SystemMonitor.layer.pipe(
          Layer.provide(Layer.succeed(MachineSampler.MachineSampler, { sample })),
        ),
      ),
    );
  }),
);
