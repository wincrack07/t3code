import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import { ServerConfig } from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as MachineSampler from "./MachineSampler.ts";

const netstat = (
  down: number,
  up: number,
) => `Name  Mtu   Network       Address            Ipkts Ierrs    Ibytes   Opkts Oerrs    Obytes  Coll
lo0   16384 <Link#1>                           1000     0   9000000    1000     0   9000000     0
lo0   16384 127           localhost            1000     -   9000000    1000     -   9000000     -
en0   1500  <Link#4>     aa:bb:cc:dd:ee:ff      100     0   ${down}      200     0   ${up}       0
en0   1500  192.168.1    192.168.1.10           100     -   ${down}      200     -   ${up}       -
en0   1500  fe80::%en0   fe80::1%en0             10     -      1000      20     -      2000     -
en1   1500  <Link#5>     11:22:33:44:55:66        0     0         0       0     0         0     0
utun0 1380  <Link#6>                             10     0      5000      10     0      6000     0`;

it.effect(
  "keeps macOS byte rates between ten-second counter refreshes on two-second samples",
  () => {
    let reads = 0;
    return Effect.gen(function* () {
      const sampler = yield* MachineSampler.MachineSampler;
      expect((yield* sampler.sample).sample.networkDown).toBeNull();
      for (let tick = 1; tick <= 10; tick++) {
        yield* TestClock.adjust("2 seconds");
        const { sample } = yield* sampler.sample;
        expect(sample.networkDown).toBe(tick < 5 ? null : 23_000);
        expect(sample.networkUp).toBe(tick < 5 ? null : 10_000);
        expect(reads).toBe(1 + Math.floor(tick / 5));
      }
    }).pipe(
      Effect.provide(
        MachineSampler.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "darwin"),
              FileSystem.layerNoop({}),
              ServerConfig.layerTest("/", { prefix: "t3-tray-sampler-" }).pipe(
                Layer.provide(NodeServices.layer),
              ),
              Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
              Layer.mock(ProjectStore.ProjectStoreV2)({}),
              Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
                string: (command) =>
                  Effect.sync(() => {
                    if (command._tag !== "StandardCommand") throw new Error("Unexpected pipeline");
                    if (command.command !== "/usr/sbin/netstat") return "";
                    const index = reads++;
                    return netstat(1_000_000 + index * 230_000, 2_000_000 + index * 100_000);
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);
