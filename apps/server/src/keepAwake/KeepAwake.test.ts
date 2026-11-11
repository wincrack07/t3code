import { updateRunActivity } from "./activity.ts";
import { expect, it } from "@effect/vitest";
import { DEFAULT_KEEP_AWAKE } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as KeepAwake from "./KeepAwake.ts";
import * as SleepInhibitor from "./SleepInhibitor.ts";

const fixture = Effect.fn("TestKeepAwake.fixture")(function* (supported = true) {
  const held = yield* Ref.make(0);
  const level = yield* Ref.make<number | null>(null);
  const crashed = yield* Deferred.make<void>();
  const saved = yield* Ref.make(DEFAULT_KEEP_AWAKE);
  const testScope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(testScope, Exit.void));
  const deps = Layer.mergeAll(
    Layer.succeed(KeepAwake.KeepAwakePreferences, {
      load: Ref.get(saved),
      save: (defaults) => Ref.set(saved, defaults),
    }),
    Layer.succeed(SleepInhibitor.SleepInhibitor, {
      supported,
      lidClosedSupported: true,
      battery: Ref.get(level),
      acquire: () =>
        Effect.acquireRelease(
          Ref.update(held, (n) => n + 1),
          () => Ref.update(held, (n) => n - 1),
        ).pipe(Effect.as(Deferred.await(crashed))),
    }),
  );
  const context = yield* Layer.build(KeepAwake.layer.pipe(Layer.provide(deps))).pipe(
    Scope.provide(testScope),
  );
  return {
    service: Context.get(context, KeepAwake.KeepAwake),
    held,
    level,
    crashed,
    testScope,
    deps,
    saved,
  };
});

it.effect(
  "follows agent activity, cancels idle release for new work, and releases after the last run",
  () =>
    Effect.gen(function* () {
      const { service, held } = yield* fixture();
      expect((yield* service.status).mode).toBe("agents");
      expect(yield* Ref.get(held)).toBe(0);
      const runs = new Map<string, string>();
      for (const [id, status] of [
        ["a", "queued"],
        ["b", "running"],
        ["c", "waiting"],
      ] as const) {
        yield* service.agentsChanged(
          updateRunActivity(runs, {
            type: "run.created",
            threadId: "thread",
            payload: { id, status },
          }),
        );
      }
      expect((yield* service.status).agents).toBe(3);
      expect((yield* service.status).active).toBe(true);
      for (const [id, status] of [
        ["a", "cancelled"],
        ["b", "completed"],
        ["c", "interrupted"],
      ] as const) {
        yield* service.agentsChanged(
          updateRunActivity(runs, {
            type: "run.updated",
            threadId: "thread",
            payload: { id, status },
          }),
        );
      }
      yield* TestClock.adjust("5 seconds");
      yield* service.agentsChanged(
        updateRunActivity(runs, {
          type: "run.created",
          threadId: "new-thread",
          payload: { id: "d", status: "queued" },
        }),
      );
      yield* TestClock.adjust("10 seconds");
      expect(yield* Ref.get(held)).toBe(1);
      yield* service.agentsChanged(
        updateRunActivity(runs, { type: "thread.deleted", threadId: "new-thread" }),
      );
      yield* TestClock.adjust("10 seconds");
      expect(yield* Ref.get(held)).toBe(0);
      expect((yield* service.status).mode).toBe("agents");
    }),
);

it.effect("expires duration and absolute sessions and cancels replaced deadlines", () =>
  Effect.gen(function* () {
    const { service, held } = yield* fixture();
    yield* service.change({ session: { mode: "duration", minutes: 60 } });
    yield* TestClock.adjust("1 hour");
    expect((yield* service.status).mode).toBe("off");
    expect(yield* Ref.get(held)).toBe(0);
    const now = yield* Clock.currentTimeMillis;
    yield* service.change({ session: { mode: "until", endsAt: now + 1000 } });
    yield* TestClock.adjust("1 second");
    expect((yield* service.status).active).toBe(false);
    yield* service.change({ session: { mode: "duration", minutes: 1 } });
    yield* service.change({ session: { mode: "indefinite" } });
    yield* TestClock.adjust("1 hour");
    expect((yield* service.status).active).toBe(true);
    yield* service.change({ session: { mode: "off" } });
    expect(yield* Ref.get(held)).toBe(0);
  }),
);

it.effect("cuts off on battery and does not restart on further agent events", () =>
  Effect.gen(function* () {
    const { service, held, level } = yield* fixture();
    yield* service.agentsChanged(1);
    yield* Ref.set(level, 20);
    yield* TestClock.adjust("1 minute");
    expect((yield* service.status).reason).toBe("Stopped at battery cutoff.");
    expect(yield* Ref.get(held)).toBe(0);
    yield* service.agentsChanged(2);
    expect(yield* Ref.get(held)).toBe(0);
    yield* service.change({ session: { mode: "indefinite" } });
    expect(yield* Ref.get(held)).toBe(0);
  }),
);

it.effect("releases its inhibitor when the service scope closes", () =>
  Effect.gen(function* () {
    const { service, held, testScope } = yield* fixture();
    yield* service.change({ session: { mode: "indefinite" } });
    expect(yield* Ref.get(held)).toBe(1);
    yield* Scope.close(testScope, Exit.void);
    expect(yield* Ref.get(held)).toBe(0);
  }),
);

it.effect("reports unsupported hosts without acquiring an inhibitor", () =>
  Effect.gen(function* () {
    const { service, held } = yield* fixture(false);
    yield* service.change({ session: { mode: "indefinite" } });
    expect((yield* service.status).supported).toBe(false);
    expect((yield* service.status).active).toBe(false);
    expect(yield* Ref.get(held)).toBe(0);
  }),
);

it.effect("releases and reports a crashed inhibitor", () =>
  Effect.gen(function* () {
    const { service, held, crashed } = yield* fixture();
    yield* service.change({ session: { mode: "indefinite" } });
    yield* Deferred.succeed(crashed, undefined);
    yield* service.changes.pipe(
      Stream.filter((s) => !s.supported),
      Stream.take(1),
      Stream.runDrain,
    );
    expect((yield* service.status).active).toBe(false);
    expect(yield* Ref.get(held)).toBe(0);
  }),
);

it.effect("saves startup defaults without replacing the current session", () =>
  Effect.gen(function* () {
    const { service, deps, saved } = yield* fixture();
    yield* service.change({ session: { mode: "indefinite" } });
    yield* service.change({
      defaults: {
        ...DEFAULT_KEEP_AWAKE,
        mode: "off",
        options: { ...DEFAULT_KEEP_AWAKE.options, batteryCutoff: 40 },
      },
    });
    expect((yield* service.status).active).toBe(true);
    expect((yield* Ref.get(saved)).mode).toBe("off");
    const restarted = yield* Layer.build(KeepAwake.layer.pipe(Layer.provide(deps)));
    const status = yield* Context.get(restarted, KeepAwake.KeepAwake).status;
    expect(status.mode).toBe("off");
    expect(status.options.batteryCutoff).toBe(40);
  }),
);
