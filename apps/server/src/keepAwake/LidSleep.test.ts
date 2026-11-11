import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as LidSleep from "./LidSleep.ts";
import { fixture } from "./LidSleep.testkit.ts";
import { lidSudoers } from "./lidAuthorization.ts";

it("grants only the current user the two exact command lines", () => {
  expect(lidSudoers("julio")).toBe(
    "Cmnd_Alias T3CODE_KEEP_AWAKE = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0\njulio ALL=(root) NOPASSWD: T3CODE_KEEP_AWAKE\n",
  );
  expect(() => lidSudoers("julio;whoami")).toThrow();
});

it.effect.each([false, true])(
  "restores only its own change (prior=%s), with fixed noninteractive argv",
  (prior) =>
    Effect.gen(function* () {
      const f = yield* fixture(prior);
      yield* Effect.gen(function* () {
        const service = yield* LidSleep.LidSleep;
        yield* service.enable;
        expect(yield* Ref.get(f.value)).toBe(true);
        yield* service.restore;
        expect(yield* Ref.get(f.value)).toBe(prior);
        expect(yield* Ref.get(f.marker)).toBe(false);
        const mutations = (yield* Ref.get(f.calls)).filter(
          ([file, args]) => file === "/usr/bin/sudo" && args.includes("disablesleep"),
        );
        expect(mutations).toEqual(
          prior
            ? []
            : [
                ["/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", "1"]],
                ["/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", "0"]],
              ],
        );
      }).pipe(Effect.provide(LidSleep.layer), Effect.provideService(LidSleep.LidSleepHost, f.host));
    }),
);

it.effect("recovers a crash marker on startup and retains it when restoration fails", () =>
  Effect.gen(function* () {
    const f = yield* fixture(true, true);
    yield* Ref.set(f.failRestore, true);
    yield* Effect.gen(function* () {
      const service = yield* LidSleep.LidSleep;
      expect((yield* service.status).error).toContain("Could not");
      expect(yield* Ref.get(f.marker)).toBe(true);
      yield* Ref.set(f.failRestore, false);
      yield* service.restore;
      expect(yield* Ref.get(f.value)).toBe(false);
      expect(yield* Ref.get(f.marker)).toBe(false);
    }).pipe(Effect.provide(LidSleep.layer), Effect.provideService(LidSleep.LidSleepHost, f.host));
  }),
);

it.effect("reports missing authorization without mutating pmset", () =>
  Effect.gen(function* () {
    const f = yield* fixture(false, false, false);
    yield* Effect.gen(function* () {
      const service = yield* LidSleep.LidSleep;
      expect((yield* service.enable.pipe(Effect.flip)).operation).toBe("authorization missing");
      expect((yield* service.status).authorized).toBe(false);
      expect(yield* Ref.get(f.value)).toBe(false);
      expect(yield* Ref.get(f.marker)).toBe(false);
    }).pipe(Effect.provide(LidSleep.layer), Effect.provideService(LidSleep.LidSleepHost, f.host));
  }),
);

it.effect("restores on graceful shutdown", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const scope = yield* Scope.make();
    yield* Layer.build(
      LidSleep.layer.pipe(Layer.provide(Layer.succeed(LidSleep.LidSleepHost, f.host))),
    ).pipe(
      Scope.provide(scope),
      Effect.flatMap((context) =>
        Effect.gen(function* () {
          const service = yield* LidSleep.LidSleep;
          yield* service.enable;
        }).pipe(Effect.provide(context)),
      ),
    );
    yield* Scope.close(scope, Exit.void);
    expect(yield* Ref.get(f.value)).toBe(false);
    expect(yield* Ref.get(f.marker)).toBe(false);
  }),
);

it.effect("recovers a marker before any new session starts", () =>
  Effect.gen(function* () {
    const f = yield* fixture(true, true);
    yield* Effect.gen(function* () {
      const service = yield* LidSleep.LidSleep;
      expect(yield* Ref.get(f.value)).toBe(false);
      expect(yield* Ref.get(f.marker)).toBe(false);
      expect((yield* service.status).active).toBe(false);
    }).pipe(Effect.provide(LidSleep.layer), Effect.provideService(LidSleep.LidSleepHost, f.host));
  }),
);

it.effect(
  "validates the sudoers file before installing and restores before removing authorization",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(false, false, false);
      yield* Effect.gen(function* () {
        const service = yield* LidSleep.LidSleep;
        yield* service.authorize(false);
        const install =
          (yield* Ref.get(f.calls)).find(([file]) => file === "/usr/bin/osascript")?.[1][1] ?? "";
        expect(install).toContain("with administrator privileges");
        expect(install.indexOf("/usr/sbin/visudo -cf")).toBeLessThan(install.indexOf("/bin/mv -f"));
        expect(install).toContain("/usr/sbin/chown root:wheel");
        expect(install).toContain("/bin/chmod 0440");
        yield* service.enable;
        yield* service.authorize(true);
        expect(yield* Ref.get(f.value)).toBe(false);
        expect(yield* Ref.get(f.marker)).toBe(false);
        expect((yield* service.status).authorized).toBe(false);
      }).pipe(Effect.provide(LidSleep.layer), Effect.provideService(LidSleep.LidSleepHost, f.host));
    }),
);
