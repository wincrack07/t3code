// @effect-diagnostics nodeBuiltinImport:off - Native fixtures verify allocated blocks and filesystem deletion boundaries.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { DEFAULT_MACHINE_CLEANUP_SETTINGS } from "@t3tools/contracts";
import { makeMachineCleanupNode } from "./machineCleanupNode.ts";
import {
  cleanupBuildProcesses,
  cleanupMeasurementPath,
  machineCacheRules,
} from "./machineCleanupRules.ts";

async function fixture(platform = "linux") {
  const home = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-cleanup-service-")),
  );
  const project = NodePath.join(home, "projects", "app");
  await NodeFSP.mkdir(project, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(project, "package.json"), "{}");
  const calls: { command: string; args: readonly string[] }[] = [];
  const measured: string[] = [];
  let processes = "";
  const backend = makeMachineCleanupNode({
    home,
    t3Home: NodePath.join(home, ".t3"),
    platform,
    now: () => Date.UTC(2026, 10, 11),
    freeSpace: async (target) => {
      measured.push(target);
      return 12 * 1024 ** 3;
    },
    activeWorktrees: async () => [],
    command: async (_cwd, command, args, signal) => {
      signal.throwIfAborted();
      calls.push({ command, args });
      if (command === "ps") return processes;
      if (command === "git") throw new Error("Not a repository");
      if (command === "pnpm") throw new Error("Not installed in fixture");
      return "";
    },
  });
  return {
    home,
    project,
    backend,
    calls,
    measured,
    settings: { ...DEFAULT_MACHINE_CLEANUP_SETTINGS, projectRoots: [NodePath.dirname(project)] },
    busy(value: string) {
      processes = value;
    },
    async [Symbol.asyncDispose]() {
      await NodeFSP.rm(home, { recursive: true, force: true });
    },
  };
}

it("scans without deletion and Phase A leaves B and C fixtures untouched", async () => {
  await using f = await fixture();
  const next = NodePath.join(f.project, ".next");
  const modules = NodePath.join(f.project, "node_modules");
  const avd = NodePath.join(f.home, ".android", "avd");
  for (const directory of [next, modules, avd]) await NodeFSP.mkdir(directory, { recursive: true });
  await NodeFSP.utimes(NodePath.join(f.project, "package.json"), 1, 1);
  const signal = new AbortController().signal;
  const report = await f.backend.scan(f.settings, signal, () => {});
  expect(report.items.filter((row) => row.outcome === "pending").map((row) => row.phase)).toEqual(
    expect.arrayContaining(["A", "B", "C"]),
  );
  expect((await NodeFSP.stat(next)).isDirectory()).toBe(true);
  const result = await f.backend.execute(report, f.settings, ["A"], [], signal, () => {});
  expect(result.items.find((row) => row.path === next)?.outcome).toBe("removed");
  expect((await NodeFSP.stat(modules)).isDirectory()).toBe(true);
  expect((await NodeFSP.stat(avd)).isDirectory()).toBe(true);
  expect(result.freeBefore).toBe(12 * 1024 ** 3);
  expect(result.freeAfter).toBe(12 * 1024 ** 3);
  expect(f.measured.every((target) => target === f.home)).toBe(true);
});

it("re-verifies inactivity and active builds immediately before deleting", async () => {
  await using f = await fixture();
  const modules = NodePath.join(f.project, "node_modules");
  await NodeFSP.mkdir(modules);
  await NodeFSP.utimes(NodePath.join(f.project, "package.json"), 1, 1);
  const signal = new AbortController().signal;
  const report = await f.backend.scan(f.settings, signal, () => {});
  const candidate = report.items.find((row) => row.path === modules)!;
  await NodeFSP.utimes(
    NodePath.join(f.project, "package.json"),
    Date.UTC(2026, 10, 11) / 1000,
    Date.UTC(2026, 10, 11) / 1000,
  );
  const result = await f.backend.execute(
    report,
    f.settings,
    ["B"],
    [candidate.id],
    signal,
    () => {},
  );
  expect(result.items.find((row) => row.id === candidate.id)?.outcome).toBe("skipped");
  expect((await NodeFSP.stat(modules)).isDirectory()).toBe(true);
  await NodeFSP.mkdir(NodePath.join(f.project, ".next"));
  f.busy("123 50 xcodebuild -project fixture");
  const busy = await f.backend.scan(f.settings, signal, () => {});
  expect(busy.items.some((row) => row.path.endsWith(".next") && row.outcome === "protected")).toBe(
    true,
  );
});

it("uses the APFS data mount and omits rules for unsupported platforms", async () => {
  await using f = await fixture("darwin");
  await f.backend.scan(f.settings, new AbortController().signal, () => {});
  expect(f.measured).toEqual(["/System/Volumes/Data", "/System/Volumes/Data"]);
  expect(cleanupMeasurementPath("linux", "/fixture")).toBe("/fixture");
  expect(machineCacheRules("win32")).toEqual([]);
  expect(machineCacheRules("linux").some((rule) => rule.id === "simulator-data")).toBe(false);
  expect(
    cleanupBuildProcesses("123 0.1 java GradleDaemon\n124 90 flutter build apk").map(
      (process) => process.busy,
    ),
  ).toEqual([false, true]);
});
