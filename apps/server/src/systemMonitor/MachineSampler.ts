import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as NodeOS from "node:os";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Schema from "effect/Schema";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect has no filesystem capacity query.
import * as NodeFSP from "node:fs/promises";
import type { MachineMonitorSnapshot, MachineProcess, MachineSample } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ServerConfig } from "../config.ts";
import {
  attributeProjects,
  macCwds,
  linuxMemory,
  linuxNetwork,
  linuxProcess,
  macMemory,
  macNetwork,
  macProcesses,
  macSwap,
  pressure,
} from "./parsers.ts";

export class MachineSampler extends Context.Service<
  MachineSampler,
  {
    readonly sample: Effect.Effect<Omit<MachineMonitorSnapshot, "history">>;
  }
>()("t3/systemMonitor/MachineSampler") {}

class MachineReadError extends Schema.TaggedError<MachineReadError>()("MachineReadError", {
  cause: Schema.Defect(),
}) {}

const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const config = yield* ServerConfig;
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const read = (path: string) => fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
  const command = (bin: string, args: string[]) =>
    spawner.string(ChildProcess.make(bin, args, { stdin: "ignore", stderr: "ignore" })).pipe(
      Effect.timeout("3 seconds"),
      Effect.orElseSucceed(() => ""),
    );
  let previousCpu: { idle: number; total: number } | undefined;
  let previousNetwork: { at: number; values: [number, number] } | undefined;
  let lastSlow = -Infinity;
  let processes: MachineProcess[] = [];
  let projects: MachineMonitorSnapshot["projects"] = [];
  let diskFree: number | null = null,
    diskTotal: number | null = null;
  let memoryAvailable = NodeOS.freemem();
  let swapUsed: number | null = null,
    swapTotal: number | null = null;
  let memoryPressure: MachineSample["pressure"] = "unknown";
  let network: [number, number] | undefined;
  let previousProcesses = new Map<number, { start: string | undefined; ticks: number }>();
  let hz: number | undefined;
  let networkDown: number | null = null,
    networkUp: number | null = null;
  const sample = Effect.fn("MachineSampler.sample")(function* () {
    const at = yield* Clock.currentTimeMillis;
    const total = NodeOS.totalmem();
    const limitations: string[] = [
      "Process memory is RSS, not physical footprint.",
      "Thread attribution is unavailable: providers do not expose verified subprocess identities.",
      "Leftovers are unavailable: launchd ownership cannot be verified.",
    ];
    const ticks = NodeOS.cpus().reduce(
      (sum, cpu) => ({
        idle: sum.idle + cpu.times.idle,
        total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
      }),
      { idle: 0, total: 0 },
    );
    const delta = previousCpu ? ticks.total - previousCpu.total : 0;
    const cpu =
      previousCpu && delta > 0
        ? Math.max(0, Math.min(100, 100 * (1 - (ticks.idle - previousCpu.idle) / delta)))
        : null;
    previousCpu = ticks;
    if (platform === "linux") {
      const mem = yield* read("/proc/meminfo");
      if (mem) {
        const parsed = yield* Effect.try({
          try: () => linuxMemory(mem),
          catch: (cause) => new MachineReadError({ cause }),
        }).pipe(Effect.orElseSucceed(() => null));
        if (parsed) {
          memoryAvailable = parsed.available;
          swapUsed = parsed.swapUsed;
          swapTotal = parsed.swapTotal;
        }
      }
      memoryPressure = pressure(memoryAvailable, total, yield* read("/proc/pressure/memory"));
      network = linuxNetwork(yield* read("/proc/net/dev"));
    }
    if (at - lastSlow >= 10_000) {
      if (hz === undefined)
        hz =
          platform === "linux"
            ? Number((yield* command("getconf", ["CLK_TCK"])).trim()) || 100
            : 100;
      const elapsed = (at - lastSlow) / 1000;
      lastSlow = at;
      const disk = yield* Effect.tryPromise({
        try: () => NodeFSP.statfs(config.baseDir),
        catch: (cause) => new MachineReadError({ cause }),
      }).pipe(Effect.orElseSucceed(() => null));
      diskFree = disk ? disk.bavail * disk.bsize : null;
      diskTotal = disk ? disk.blocks * disk.bsize : null;
      if (platform === "darwin") {
        const vm = yield* command("/usr/bin/vm_stat", []);
        memoryAvailable = yield* Effect.try({
          try: () => macMemory(vm, total),
          catch: (cause) => new MachineReadError({ cause }),
        }).pipe(Effect.orElseSucceed(() => NodeOS.freemem()));
        const swap = macSwap(yield* command("/usr/sbin/sysctl", ["-n", "vm.swapusage"]));
        swapUsed = swap.swapUsed;
        swapTotal = swap.swapTotal;
        memoryPressure = pressure(
          memoryAvailable,
          total,
          "",
          yield* command("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
        );
        network = macNetwork(yield* command("/usr/sbin/netstat", ["-ibn"]));
        processes = macProcesses(
          yield* command("/bin/ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="]),
        );
        const cwds = macCwds(
          yield* command("/usr/sbin/lsof", [
            "-a",
            "-d",
            "cwd",
            "-Fpn",
            "-u",
            String(process.getuid?.() ?? 0),
          ]),
        );
        processes = processes.map((p) => ({ ...p, cwd: cwds.get(p.pid) ?? null }));
      } else if (platform === "linux") {
        const pids = yield* fs.readDirectory("/proc").pipe(Effect.orElseSucceed(() => []));
        const next = new Map<number, { start: string | undefined; ticks: number }>();
        processes = (yield* Effect.forEach(
          pids.filter((p) => /^\d+$/.test(p)),
          (id) =>
            Effect.gen(function* () {
              const stat = yield* read(`/proc/${id}/stat`);
              if (!stat) return null;
              const p = linuxProcess(stat),
                pid = Number(id);
              if (!Number.isFinite(p.ticks)) return null;
              const status = yield* read(`/proc/${id}/status`);
              const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
              const cwd = yield* fs
                .readLink(`/proc/${id}/cwd`)
                .pipe(Effect.orElseSucceed(() => null));
              const old = previousProcesses.get(pid);
              next.set(pid, { start: p.start, ticks: p.ticks });
              return {
                pid,
                ppid: p.ppid,
                name: p.name.slice(0, 120),
                owner: null,
                rss,
                cwd,
                cpu:
                  old && old.start === p.start && Number.isFinite(elapsed)
                    ? Math.max(0, ((p.ticks - old.ticks) / hz! / elapsed) * 100)
                    : 0,
              };
            }),
          { concurrency: 16 },
        )).filter((p): p is NonNullable<typeof p> => p !== null);
        previousProcesses = next;
      } else limitations.push("Machine sampling is supported on Linux and macOS only.");
      const shell = yield* store.getShellSnapshot().pipe(Effect.orElseSucceed(() => null));
      const projectShells = yield* projectStore.listShells().pipe(Effect.orElseSucceed(() => []));
      projects = shell
        ? attributeProjects(
            processes,
            projectShells.flatMap((project) => [
              { id: project.id, title: project.title, path: project.workspaceRoot },
              ...shell.threads
                .filter((t) => t.projectId === project.id && t.worktreePath)
                .map((t) => ({ id: project.id, title: project.title, path: t.worktreePath! })),
            ]),
          )
        : [];
    }
    if (network && (platform !== "darwin" || at === lastSlow)) {
      if (previousNetwork && at > previousNetwork.at) {
        const seconds = (at - previousNetwork.at) / 1000;
        networkDown = Math.max(0, (network[0] - previousNetwork.values[0]) / seconds);
        networkUp = Math.max(0, (network[1] - previousNetwork.values[1]) / seconds);
      }
      previousNetwork = { at, values: network };
    }
    return {
      sample: {
        at,
        cpu,
        memoryUsed: total - memoryAvailable,
        memoryAvailable,
        memoryTotal: total,
        pressure: memoryPressure,
        swapUsed,
        swapTotal,
        diskFree,
        diskTotal,
        networkDown,
        networkUp,
        load: NodeOS.loadavg(),
        uptime: NodeOS.uptime(),
      },
      projects,
      processesAt: lastSlow,
      topMemory: [...processes].sort((a, b) => b.rss - a.rss).slice(0, 30),
      topCpu: [...processes].sort((a, b) => b.cpu - a.cpu).slice(0, 30),
      limitations,
    };
  });
  return MachineSampler.of({ sample: sample() });
});
export const layer = Layer.effect(MachineSampler, make);
