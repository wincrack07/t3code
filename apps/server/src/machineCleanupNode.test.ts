// @effect-diagnostics nodeBuiltinImport:off - Native fixtures verify allocated blocks and filesystem deletion boundaries.
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { DEFAULT_MACHINE_CLEANUP_SETTINGS } from "@t3tools/contracts";
import { makeMachineCleanupNode } from "./machineCleanupNode.ts";
import {
  cleanupBuildProcesses,
  cleanupMeasurementPath,
  dockerBuildCacheBytes,
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
  let pnpmStore: string | null = null;
  let gitRunner: ((cwd: string, args: readonly string[]) => Promise<string>) | null = null;
  let active: readonly string[] = [];
  const backend = makeMachineCleanupNode({
    home,
    t3Home: NodePath.join(home, ".t3"),
    platform,
    now: () => Date.UTC(2026, 10, 11),
    freeSpace: async (target) => {
      measured.push(target);
      return 12 * 1024 ** 3;
    },
    activeWorktrees: async () => active,
    command: async (_cwd, command, args, signal) => {
      signal.throwIfAborted();
      calls.push({ command, args });
      if (command === "ps") return processes;
      if (command === "git") {
        if (gitRunner) return gitRunner(_cwd, args);
        throw new Error("Not a repository");
      }
      if (command === "pnpm") {
        if (pnpmStore !== null) return pnpmStore;
        throw new Error("Not installed in fixture");
      }
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
    useGit(run: (cwd: string, args: readonly string[]) => Promise<string>) {
      gitRunner = run;
    },
    active(paths: readonly string[]) {
      active = paths;
    },
    store(value: string) {
      pnpmStore = value;
    },
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
  const npmCache = NodePath.join(f.home, ".npm");
  for (const directory of [next, modules, avd, npmCache])
    await NodeFSP.mkdir(directory, { recursive: true });
  await NodeFSP.utimes(NodePath.join(f.project, "package.json"), 1, 1);
  const signal = new AbortController().signal;
  const report = await f.backend.scan(f.settings, signal, () => {});
  expect(report.items.filter((row) => row.outcome === "pending").map((row) => row.phase)).toEqual(
    expect.arrayContaining(["A", "B", "C"]),
  );
  expect((await NodeFSP.stat(next)).isDirectory()).toBe(true);
  const disabled = await f.backend.scan(
    { ...f.settings, enabledRules: ["*", "!next"] },
    signal,
    () => {},
  );
  expect(disabled.items.some((item) => item.path === next && item.outcome === "pending")).toBe(
    false,
  );
  const result = await f.backend.execute(report, f.settings, ["A"], [], signal, () => {});
  expect(result.items.find((row) => row.path === next)?.outcome).toBe("removed");
  expect((await NodeFSP.stat(modules)).isDirectory()).toBe(true);
  expect((await NodeFSP.stat(avd)).isDirectory()).toBe(true);
  expect(
    f.calls.some(
      (call) =>
        call.command === "npm" && call.args.includes("--cache") && call.args.includes(npmCache),
    ),
  ).toBe(true);
  expect(result.freeBefore).toBe(12 * 1024 ** 3);
  expect(result.freeAfter).toBe(12 * 1024 ** 3);
  expect(result.measurements).toEqual([
    { phase: "A", itemId: report.items[0]!.id, before: 12 * 1024 ** 3, after: 12 * 1024 ** 3 },
  ]);
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

it("attempts one notification per run and alerts on low space without pending items", async () => {
  await using f = await fixture();
  const signal = new AbortController().signal;
  const scan = await f.backend.scan(f.settings, signal, () => {});
  const report = { ...scan, mode: "unattended" as const, items: [], freeAfter: 5 * 1024 ** 3 };
  await f.backend.notify(report, f.settings, signal);
  await f.backend.notify(report, f.settings, signal);
  expect(f.calls.filter((call) => call.command === "notify-send")).toHaveLength(1);
  await f.backend.notify({ ...report, id: "dry-run", mode: "scan" }, f.settings, signal);
  expect(f.calls.filter((call) => call.command === "notify-send")).toHaveLength(1);
});

it("parses Docker cache sizes without using sparse VM apparent sizes", () => {
  expect(dockerBuildCacheBytes('{"Type":"Build Cache","Size":"2.5GB"}')).toBe(2_500_000_000);
  expect(dockerBuildCacheBytes('{"Type":"Build Cache","Size":"2GiB"}')).toBe(2 * 1024 ** 3);
  expect(dockerBuildCacheBytes('{"Type":"Images","Size":"8GB"}')).toBeNull();
  expect(dockerBuildCacheBytes("invalid")).toBeNull();
});

it("rechecks real worktrees, retains dirty/protected/active work and removes clean approved trees without force or branch deletion", async () => {
  await using f = await fixture();
  const exec = NodeUtil.promisify(NodeChildProcess.execFile);
  const git = async (cwd: string, args: readonly string[]) =>
    (
      await exec("git", [...args], {
        cwd,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
          ),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      })
    ).stdout;
  f.useGit(git);
  const repository = NodePath.join(f.home, "main");
  const remote = NodePath.join(f.home, "remote.git");
  const linked = NodePath.join(f.home, "topic");
  await NodeFSP.mkdir(repository);
  await git(f.home, ["init", "--bare", remote]);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.email", "fixture@example.invalid"]);
  await git(repository, ["config", "user.name", "Fixture"]);
  await NodeFSP.writeFile(NodePath.join(repository, "source"), "fixture");
  await NodeFSP.writeFile(NodePath.join(repository, ".gitignore"), ".env\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "fixture"]);
  await git(repository, ["remote", "add", "origin", remote]);
  await git(repository, ["push", "-u", "origin", "main"]);
  await git(repository, ["worktree", "add", "-b", "topic", linked]);
  const signal = new AbortController().signal;
  const report = await f.backend.scan(f.settings, signal, () => {});
  const candidate = report.items.find((item) => item.path === linked)!;
  expect(candidate.outcome).toBe("pending");
  await NodeFSP.writeFile(NodePath.join(linked, "source"), "unsaved");
  expect(
    (
      await f.backend.execute(report, f.settings, ["B"], [candidate.id], signal, () => {})
    ).items.find((item) => item.id === candidate.id)?.outcome,
  ).toBe("skipped");
  expect(await NodeFSP.readFile(NodePath.join(linked, "source"), "utf8")).toBe("unsaved");
  await NodeFSP.writeFile(NodePath.join(linked, "source"), "fixture");
  await NodeFSP.writeFile(NodePath.join(linked, ".env"), "fixture");
  expect(
    (
      await f.backend.execute(report, f.settings, ["B"], [candidate.id], signal, () => {})
    ).items.find((item) => item.id === candidate.id)?.outcome,
  ).toBe("skipped");
  await NodeFSP.unlink(NodePath.join(linked, ".env"));
  f.active([linked]);
  expect(
    (
      await f.backend.execute(report, f.settings, ["B"], [candidate.id], signal, () => {})
    ).items.find((item) => item.id === candidate.id)?.outcome,
  ).toBe("skipped");
  expect(
    f.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree" && call.args[1] === "remove",
    ),
  ).toBe(false);
  f.active([]);
  expect(
    (
      await f.backend.execute(report, f.settings, ["B"], [candidate.id], signal, () => {})
    ).items.find((item) => item.id === candidate.id)?.outcome,
  ).toBe("removed");
  expect(
    f.calls
      .filter(
        (call) =>
          call.command === "git" && call.args[0] === "worktree" && call.args[1] === "remove",
      )
      .every((call) => !call.args.includes("--force")),
  ).toBe(true);
  expect(await git(repository, ["show-ref", "--verify", "refs/heads/topic"])).toContain(
    "refs/heads/topic",
  );
});

it("retains a pnpm cache containing the full store and re-verifies a moved store", async () => {
  await using f = await fixture();
  const cache = NodePath.join(f.home, ".cache/pnpm");
  const store = NodePath.join(cache, "store/v10");
  await NodeFSP.mkdir(store, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(store, "package"), "retained");
  f.store(store);
  const signal = new AbortController().signal;
  const report = await f.backend.scan(f.settings, signal, () => {});
  expect(report.items.some((item) => item.rule === "linux-pnpm")).toBe(false);
  const full = report.items.find((item) => item.rule === "pnpm-full")!;
  expect(full.path).toBe(store);
  f.store(NodePath.join(f.home, "different-store"));
  const result = await f.backend.execute(report, f.settings, ["C"], [full.id], signal, () => {});
  expect(result.items.find((item) => item.id === full.id)?.outcome).toBe("skipped");
  expect(await NodeFSP.readFile(NodePath.join(store, "package"), "utf8")).toBe("retained");
});
