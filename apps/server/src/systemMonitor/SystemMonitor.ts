import type { MachineMonitorSnapshot, MachineSample } from "@t3tools/contracts";
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
    readonly stream: Stream.Stream<MachineMonitorSnapshot>;
  }
>()("t3/systemMonitor/SystemMonitor") {}

const make = Effect.gen(function* () {
  const sampler = yield* MachineSampler.MachineSampler;
  const owner = yield* Effect.scope;
  const mutex = yield* Semaphore.make(1);
  const sampleMutex = yield* Semaphore.make(1);
  const updates = yield* PubSub.sliding<MachineMonitorSnapshot>(1);
  const recent = new Ring<MachineSample>(450);
  const coarse = new Ring<MachineSample>(288);
  let lastCoarse = -Infinity;
  let latest: MachineMonitorSnapshot | undefined;
  let subscribers = 0;
  let running: Scope.Closeable | undefined;
  const current = Effect.gen(function* () {
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
  }).pipe(sampleMutex.withPermit);
  const tick = Effect.gen(function* () {
    const value = yield* current;
    // History is sent on subscription; subsequent frames carry only the new point.
    yield* PubSub.publish(updates, {
      ...value,
      history: value.sample.at === lastCoarse ? value.history : [],
    });
  });
  const acquire = mutex.withPermit(
    Effect.gen(function* () {
      const queue = yield* PubSub.subscribe(updates);
      subscribers++;
      if (subscribers === 1) {
        running = yield* Scope.fork(owner);
        yield* tick.pipe(
          Effect.andThen(Effect.sleep("2 seconds")),
          Effect.forever,
          Effect.forkIn(running),
        );
      }
      yield* Effect.addFinalizer(() =>
        mutex.withPermit(
          Effect.gen(function* () {
            subscribers--;
            if (subscribers === 0 && running) {
              yield* Scope.close(running, Exit.void);
              running = undefined;
            }
          }),
        ),
      );
      return Stream.concat(
        latest ? Stream.make(latest) : Stream.empty,
        Stream.fromSubscription(queue),
      );
    }),
  );
  return SystemMonitor.of({
    current: current.pipe(Effect.map((value) => ({ ...value, history: [] }))),
    stream: Stream.unwrap(acquire),
  });
});
export const layer = Layer.effect(SystemMonitor, make);
