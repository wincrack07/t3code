import type {
  MachineMonitorSnapshot,
  MachineProcessSnapshot,
  MachineSample,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as MachineSampler from "./MachineSampler.ts";
import { Ring } from "./history.ts";

export class SystemMonitor extends Context.Service<
  SystemMonitor,
  {
    readonly current: Effect.Effect<MachineMonitorSnapshot>;
    readonly stream: (input: {
      readonly detail?: boolean;
    }) => Stream.Stream<MachineMonitorSnapshot>;
  }
>()("t3/systemMonitor/SystemMonitor") {}

const make = Effect.gen(function* () {
  const sampler = yield* MachineSampler.MachineSampler;
  const owner = yield* Effect.scope;
  const mutex = yield* Semaphore.make(1);
  const sampleMutex = yield* Semaphore.make(1);
  const updates = yield* PubSub.sliding<MachineMonitorSnapshot>(1);
  const processUpdates = yield* PubSub.sliding<MachineProcessSnapshot>(1);
  const recent = new Ring<MachineSample>(450);
  const coarse = new Ring<MachineSample>(288);
  let lastCoarse = -Infinity;
  let latest: MachineMonitorSnapshot | undefined;
  let latestDetails: MachineProcessSnapshot | undefined;
  let subscribers = 0;
  let detailSubscribers = 0;
  let running: Scope.Closeable | undefined;
  let detailsRunning: Scope.Closeable | undefined;
  const read = Effect.fn("SystemMonitor.read")(function* () {
    const value = yield* sampler.sample;
    recent.append(value.sample);
    if (value.sample.at - lastCoarse >= 300_000) {
      coarse.append(value.sample);
      lastCoarse = value.sample.at;
    }
    latest = {
      ...value,
      history: [...coarse.read().filter((p) => p.at < value.sample.at - 900_000), ...recent.read()],
    };
    return latest;
  }, sampleMutex.withPermit);
  const tick = Effect.gen(function* () {
    const value = yield* read();
    yield* PubSub.publish(updates, {
      ...value,
      history: value.sample.at === lastCoarse ? value.history : [],
    });
  });
  const processTick = Effect.gen(function* () {
    latestDetails = yield* sampler.processes;
    yield* PubSub.publish(processUpdates, latestDetails);
  }).pipe(sampleMutex.withPermit);
  const acquire = Effect.fn("SystemMonitor.subscribe")(
    function* (input: { readonly detail?: boolean }) {
      const queue = yield* PubSub.subscribe(updates);
      const processQueue = input.detail ? yield* PubSub.subscribe(processUpdates) : undefined;
      if (subscribers === 0) {
        yield* read().pipe(Effect.interruptible);
        running = yield* Scope.fork(owner);
        yield* Effect.sleep("2 seconds").pipe(
          Effect.andThen(tick),
          Effect.forever,
          Effect.interruptible,
          Effect.forkIn(running),
        );
      }
      subscribers++;
      const initial = {
        ...latest!,
        ...(input.detail && latestDetails ? { details: latestDetails } : {}),
      };
      if (input.detail && detailSubscribers++ === 0) {
        detailsRunning = yield* Scope.fork(owner);
        yield* processTick.pipe(
          Effect.andThen(Effect.sleep("10 seconds")),
          Effect.forever,
          Effect.interruptible,
          Effect.forkIn(detailsRunning),
        );
      }
      yield* Effect.addFinalizer(() =>
        mutex.withPermit(
          Effect.gen(function* () {
            if (input.detail && --detailSubscribers === 0 && detailsRunning) {
              yield* Scope.close(detailsRunning, Exit.void);
              detailsRunning = undefined;
              latestDetails = undefined;
            }
            if (--subscribers === 0 && running) {
              yield* Scope.close(running, Exit.void);
              running = undefined;
            }
          }),
        ),
      );
      const resources = input.detail
        ? Stream.fromSubscription(queue)
        : Stream.fromSubscription(queue).pipe(Stream.map((value) => ({ ...value, history: [] })));
      const live = processQueue
        ? Stream.merge(
            resources,
            Stream.fromSubscription(processQueue).pipe(
              Stream.map((details) => ({ ...latest!, history: [], details })),
            ),
          )
        : resources;
      return Stream.concat(Stream.make(input.detail ? initial : { ...initial, history: [] }), live);
    },
    mutex.withPermit,
    Effect.uninterruptible,
  );
  return SystemMonitor.of({
    current: read().pipe(Effect.map((value) => ({ ...value, history: [] }))),
    stream: (input) => Stream.unwrap(acquire(input)),
  });
});
export const layer = Layer.effect(SystemMonitor, make);
