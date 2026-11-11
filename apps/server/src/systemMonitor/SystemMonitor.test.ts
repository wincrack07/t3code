import { expect, it } from "@effect/vitest";
import type { MachineMonitorSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as MachineSampler from "./MachineSampler.ts";
import * as SystemMonitor from "./SystemMonitor.ts";

it.effect(
  "shares sampling, collects processes only for detail viewers and stops each path on unsubscribe",
  () =>
    Effect.gen(function* () {
      const blocked = yield* Deferred.make<void>();
      const cancelled = yield* Deferred.make<void>();
      let count = 0;
      let processCount = 0;
      const sample = Effect.gen(function* () {
        count++;
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
          limitations: [],
        };
      });
      const processes = Effect.gen(function* () {
        processCount++;
        if (processCount === 4) {
          return yield* Deferred.succeed(blocked, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
          );
        }
        return {
          sampledAt: yield* Clock.currentTimeMillis,
          projects: [],
          threads: [],
          topMemory: [
            { pid: 42, ppid: 1, name: "node", owner: null, cwd: "/repo", rss: 100, cpu: 200 },
          ],
          topCpu: [],
          limitations: [],
        };
      });
      yield* Effect.gen(function* () {
        const monitor = yield* SystemMonitor.SystemMonitor;
        const resourceFrames = yield* Queue.unbounded<MachineMonitorSnapshot>();
        const one = yield* Scope.make();
        yield* monitor.stream({}).pipe(
          Stream.runForEach((frame) => Queue.offer(resourceFrames, frame)),
          Effect.forkIn(one),
        );
        expect((yield* Queue.take(resourceFrames)).details).toBeUndefined();
        yield* TestClock.adjust("12 seconds");
        expect(count).toBe(7);
        expect(processCount).toBe(0);
        expect(
          (yield* Queue.takeAll(resourceFrames)).every((frame) => frame.details === undefined),
        ).toBe(true);

        const detailsOne = yield* Scope.make();
        const detailsTwo = yield* Scope.make();
        const detailFrames = yield* Queue.unbounded<MachineMonitorSnapshot>();
        const detailResourceFrames: MachineMonitorSnapshot[] = [];
        const collect = (frame: MachineMonitorSnapshot) =>
          frame.details
            ? Queue.offer(detailFrames, frame)
            : Effect.sync(() => {
                detailResourceFrames.push(frame);
              });
        yield* monitor
          .stream({ detail: true })
          .pipe(Stream.runForEach(collect), Effect.forkIn(detailsOne));
        expect((yield* Queue.take(detailFrames)).details?.topMemory[0]?.pid).toBe(42);
        expect(processCount).toBe(1);
        yield* monitor
          .stream({ detail: true })
          .pipe(Stream.runForEach(collect), Effect.forkIn(detailsTwo));
        expect((yield* Queue.take(detailFrames)).details?.sampledAt).toBe(12_000);
        expect(processCount).toBe(1);
        yield* TestClock.adjust("2 seconds");
        expect(processCount).toBe(1);
        expect(detailResourceFrames.at(-1)?.sample.at).toBe(14_000);
        expect(detailResourceFrames.at(-1)?.details).toBeUndefined();
        expect(
          (yield* Queue.takeAll(resourceFrames)).every((frame) => frame.details === undefined),
        ).toBe(true);

        const two = yield* Scope.make();
        const secondFrames = yield* Queue.unbounded<MachineMonitorSnapshot>();
        yield* monitor.stream({ detail: false }).pipe(
          Stream.runForEach((frame) => Queue.offer(secondFrames, frame)),
          Effect.forkIn(two),
        );
        expect((yield* Queue.take(secondFrames)).details).toBeUndefined();
        yield* Scope.close(detailsOne, Exit.void);
        yield* TestClock.adjust("8 seconds");
        expect((yield* Queue.take(detailFrames)).details?.sampledAt).toBe(22_000);
        expect(processCount).toBe(2);
        yield* Scope.close(detailsTwo, Exit.void);
        yield* TestClock.adjust("20 seconds");
        expect(processCount).toBe(2);
        expect(
          (yield* Queue.takeAll(secondFrames)).every((frame) => frame.details === undefined),
        ).toBe(true);

        const reopened = yield* Scope.make();
        yield* monitor
          .stream({ detail: true })
          .pipe(Stream.runForEach(collect), Effect.forkIn(reopened));
        expect((yield* Queue.take(detailFrames)).details?.sampledAt).toBe(42_000);
        expect(processCount).toBe(3);
        yield* Scope.close(reopened, Exit.void);
        yield* Scope.close(one, Exit.void);
        const before = count;
        yield* TestClock.adjust("2 seconds");
        expect(count).toBe(before + 1);
        yield* Scope.close(two, Exit.void);
        const stopped = count;
        yield* TestClock.adjust("20 seconds");
        expect(count).toBe(stopped);
        expect((yield* monitor.current).details).toBeUndefined();
        expect(processCount).toBe(3);

        const indicator = yield* Scope.make();
        yield* monitor.stream({}).pipe(Stream.runDrain, Effect.forkIn(indicator));
        const blockedView = yield* Scope.make();
        yield* monitor.stream({ detail: true }).pipe(Stream.runDrain, Effect.forkIn(blockedView));
        yield* Deferred.await(blocked);
        yield* Scope.close(blockedView, Exit.void);
        yield* Deferred.await(cancelled);
        const resumed = count;
        yield* TestClock.adjust("2 seconds");
        expect(count).toBe(resumed + 1);
        expect(processCount).toBe(4);
        yield* Scope.close(indicator, Exit.void);
      }).pipe(
        Effect.provide(
          SystemMonitor.layer.pipe(
            Layer.provide(Layer.succeed(MachineSampler.MachineSampler, { sample, processes })),
          ),
        ),
      );
    }),
);
