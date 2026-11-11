// @effect-diagnostics nodeBuiltinImport:off - Node adapter owns native process, allocated-block and filesystem operations.
import { cleanupNotification } from "./machineCleanupSchedule.ts";
import * as DateTime from "effect/DateTime";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import type {
  MachineCleanupItem,
  MachineCleanupReport,
  MachineCleanupSettings,
} from "@t3tools/contracts";
import {
  allocatedCleanupBytes,
  deleteCleanupPath,
  scanMachineProjects,
  verifyCleanupPath,
  type CleanupScope,
} from "./machineCleanup.ts";
import { assessCleanupWorktrees, type CleanupGitRunner } from "./machineCleanupWorktrees.ts";
import {
  cleanupBuildProcesses,
  cleanupMeasurementPath,
  machineCacheRules,
  machineRuleEnabled,
  type MachineCacheRule,
} from "./machineCleanupRules.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
export interface CleanupNodeOptions {
  readonly home: string;
  readonly t3Home: string;
  readonly platform: string;
  readonly now: () => number;
  readonly command: (
    cwd: string,
    command: string,
    args: readonly string[],
    signal: AbortSignal,
  ) => Promise<string>;
  readonly activeWorktrees: () => Promise<readonly string[]>;
  readonly freeSpace: (target: string) => Promise<number>;
}

export async function cleanupNodeCommand(
  cwd: string,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) {
  const { stdout } = await execFile(command, [...args], {
    cwd,
    signal,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      ...(command === "flutter" && args[0] === "pub" && args[1] === "cache"
        ? { PUB_CACHE: NodePath.join(cwd, ".pub-cache") }
        : {}),
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  return stdout;
}

export async function cleanupNodeFreeSpace(target: string) {
  const stat = await NodeFSP.statfs(target);
  return stat.bavail * stat.bsize;
}

const exists = async (target: string) =>
  NodeFSP.lstat(target).then(
    () => true,
    () => false,
  );
const expand = (home: string, target: string) =>
  target === "~" ? home : target.startsWith("~/") ? NodePath.join(home, target.slice(2)) : target;
const idFor = (rule: string, target: string) =>
  NodeCrypto.createHash("sha256").update(`${rule}\0${target}`).digest("hex").slice(0, 24);
const pruneNames = new Set([
  "node_modules",
  ".Trash",
  "Pods",
  ".dart_tool",
  ".cache",
  ".npm",
  ".pub-cache",
  ".git",
]);

export function makeMachineCleanupNode(options: CleanupNodeOptions) {
  const scopeFor = (
    settings: MachineCleanupSettings,
    exactPaths: readonly string[] = [],
  ): CleanupScope => ({
    home: options.home,
    t3Home: options.t3Home,
    roots: settings.projectRoots.map((root) => expand(options.home, root)),
    protectedPaths: settings.protectedPaths.map((root) => expand(options.home, root)),
    exactPaths,
  });
  const scan = async (
    settings: MachineCleanupSettings,
    signal: AbortSignal,
    progress: (target: string) => void,
  ): Promise<MachineCleanupReport> => {
    if (options.platform !== "linux" && options.platform !== "darwin")
      throw new Error("Machine cleanup is not supported on Windows");
    const measurementPath = cleanupMeasurementPath(options.platform, options.home);
    const report: MachineCleanupReport = {
      id: NodeCrypto.randomUUID(),
      mode: "scan",
      platform: options.platform,
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(options.now())),
      finishedAt: null,
      measurementPath,
      freeBefore: await options.freeSpace(measurementPath),
      freeAfter: 0,
      items: [],
      notes: [],
    };
    const items: MachineCleanupItem[] = [];
    const notes: string[] = [];
    const run = (command: string, args: readonly string[], cwd = options.home) =>
      options.command(cwd, command, args, signal);
    const git: CleanupGitRunner = {
      git: (cwd, args) => run("git", args, cwd),
      mergedPullRequests: async (cwd, branch) => {
        const value: unknown = JSON.parse(
          await run(
            "gh",
            [
              "pr",
              "list",
              "--head",
              branch,
              "--state",
              "merged",
              "--json",
              "headRefOid",
              "--limit",
              "100",
            ],
            cwd,
          ),
        );
        return Array.isArray(value)
          ? value.filter(
              (row): row is { headRefOid: string } =>
                typeof row === "object" &&
                row !== null &&
                "headRefOid" in row &&
                typeof row.headRefOid === "string",
            )
          : [];
      },
    };
    const processes = cleanupBuildProcesses(await run("ps", ["-axo", "pid=,pcpu=,args="]));
    const activeBuild = async () => processes.some((entry) => entry.busy);
    const projectScan = await scanMachineProjects({
      scope: scopeFor(settings),
      now: options.now(),
      inactivityDays: settings.inactivityDays,
      signal,
      progress,
      activeBuild,
      lastCommit: async (cwd) => {
        try {
          await git.git(cwd, ["rev-parse", "--git-dir"]);
        } catch {
          return null;
        }
        const date = Number((await git.git(cwd, ["log", "-1", "--format=%ct"])).trim());
        if (!Number.isFinite(date) || date <= 0) throw new Error("Invalid commit date");
        return date * 1000;
      },
    });
    const item = (
      rule: string,
      target: string,
      phase: MachineCleanupItem["phase"],
      bytes: number,
      effect: string,
    ): MachineCleanupItem => ({
      id: idFor(rule, target),
      path: target,
      rule,
      phase,
      bytes,
      effect,
      probablyActive: false,
      outcome: "pending",
      reason: "",
      project: "",
      branch: null,
      changes: 0,
      head: null,
    });
    for (const candidate of projectScan.candidates) {
      if (candidate.phase === "A" && !machineRuleEnabled(settings, candidate.rule)) continue;
      items.push({
        ...item(
          candidate.rule,
          candidate.path,
          candidate.phase,
          candidate.bytes,
          "Generated files download or build again",
        ),
        project: candidate.project,
      });
    }
    for (const skipped of projectScan.skipped)
      items.push({
        ...item("project", skipped.path, "A", 0, ""),
        outcome: "protected",
        reason: skipped.reason,
      });
    const rules = [...machineCacheRules(options.platform)];
    if (options.platform === "darwin") {
      for (const name of await NodeFSP.readdir(NodePath.join(options.home, "Library/Caches")).catch(
        () => [],
      )) {
        if (name.endsWith(".ShipIt") || name.endsWith("-updater"))
          rules.push({
            id: "mac-updater",
            relativePath: `Library/Caches/${name}`,
            phase: "A",
            effect: "Updater downloads again",
          });
      }
    }
    try {
      const toolchains = await run("rustup", ["toolchain", "list"]);
      for (const line of toolchains.split(/\r?\n/)) {
        const name = line.trim();
        if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
        rules.push({
          id: `rustup:${name}`,
          relativePath: `.rustup/toolchains/${name}`,
          phase: "C",
          effect: "This non-default Rust toolchain must be downloaded again",
          command: ["rustup", "toolchain", "uninstall", name],
        });
      }
    } catch {
      notes.push("Rust toolchains unavailable");
    }
    const local = NodePath.join(options.home, ".local");
    const visitLocal = async (directory: string): Promise<void> => {
      signal.throwIfAborted();
      const entries = await NodeFSP.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = NodePath.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        try {
          await verifyCleanupPath(target, scopeFor(settings, [local]));
        } catch {
          continue;
        }
        if (
          entry.isFile() &&
          entry.name === ".DS_Store" &&
          machineRuleEnabled(settings, "ds-store")
        )
          items.push(
            item(
              "ds-store",
              target,
              "A",
              await allocatedCleanupBytes(target, signal),
              "Remove Finder metadata",
            ),
          );
        else if (entry.isDirectory() && !pruneNames.has(entry.name)) await visitLocal(target);
      }
    };
    if (options.platform === "darwin" && (await exists(local))) await visitLocal(local);
    for (const rule of rules) {
      signal.throwIfAborted();
      if (rule.phase === "A" && !machineRuleEnabled(settings, rule.id)) continue;
      let target = NodePath.join(options.home, rule.relativePath);
      if (rule.id.startsWith("pnpm-")) {
        try {
          target = (await run("pnpm", ["store", "path", "--silent"])).trim();
        } catch {
          notes.push("pnpm store path unavailable; pnpm rule skipped");
          continue;
        }
      }
      if (!(await exists(target))) continue;
      const targets = rule.children
        ? (await NodeFSP.readdir(target)).map((name) => NodePath.join(target, name))
        : [target];
      for (const child of targets) {
        progress(child);
        try {
          await verifyCleanupPath(child, scopeFor(settings, [child]));
          if (rule.emptyOnly && (await NodeFSP.readdir(child)).length !== 0) continue;
          const bytes = await allocatedCleanupBytes(child, signal);
          const blocked =
            rule.gradle &&
            processes.some(
              (entry) => entry.command.includes("gradle") || entry.command.includes("Gradle"),
            );
          const xcodeBusy = rule.id === "derived-data" && processes.some((entry) => entry.busy);
          items.push({
            ...item(rule.id, child, rule.phase, bytes, rule.effect),
            ...(rule.phase === "A" && (blocked || xcodeBusy)
              ? { outcome: "protected" as const, reason: "Active build or Gradle daemon; retained" }
              : {}),
          });
        } catch {
          items.push({
            ...item(rule.id, child, rule.phase, 0, rule.effect),
            outcome: "protected",
            reason: "Protected, symlinked or unreadable path",
          });
        }
      }
    }
    const repositories = new Set<string>();
    const search = async (directory: string, depth: number): Promise<void> => {
      signal.throwIfAborted();
      progress(directory);
      if (depth > 8) return;
      if (
        ["Library/Caches", "Library/Containers", "Library/Group Containers"].some(
          (name) => directory === NodePath.join(options.home, name),
        )
      )
        return;
      if (directory !== options.home) {
        try {
          await verifyCleanupPath(directory, { ...scopeFor(settings), roots: [options.home] });
        } catch {
          return;
        }
      }
      let entries;
      try {
        entries = await NodeFSP.readdir(directory, { withFileTypes: true });
      } catch {
        notes.push(`Cannot read ${directory}`);
        return;
      }
      if (entries.some((entry) => entry.name === ".git")) {
        try {
          const common = await git.git(directory, [
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ]);
          const key = common.trim();
          if (!repositories.has(key)) {
            repositories.add(key);
            const assessments = await assessCleanupWorktrees({
              repository: directory,
              runner: git,
              now: options.now(),
              signal,
              exists,
              createdAt: async (target) => (await NodeFSP.stat(target)).birthtimeMs,
              active: async (target) =>
                (await options.activeWorktrees()).some(
                  (active) => active === target || active.startsWith(`${target}${NodePath.sep}`),
                ),
            });
            for (const entry of assessments) {
              if (entry.outcome === "keep") continue;
              const wt = entry.worktree;
              const row = {
                ...item("worktree", wt.path, "B", 0, "Remove the merged worktree; keep its branch"),
                project: directory,
                head: wt.head,
                branch: wt.branch,
                changes: entry.changes,
                probablyActive: entry.probablyActive,
                reason: entry.reason,
              };
              if (entry.outcome === "candidate") {
                try {
                  await verifyCleanupPath(wt.path, scopeFor(settings, [wt.path]));
                  items.push({ ...row, bytes: await allocatedCleanupBytes(wt.path, signal) });
                } catch {
                  items.push({ ...row, outcome: "protected", reason: "Protected worktree path" });
                }
              } else
                items.push({ ...row, outcome: entry.outcome === "dirty" ? "dirty" : "protected" });
            }
          }
        } catch {
          notes.push(
            `Git worktree scan failed for ${directory}; no worktrees from it will be removed`,
          );
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !pruneNames.has(entry.name))
          await search(NodePath.join(directory, entry.name), depth + 1);
      }
    };
    await search(options.home, 0);
    signal.throwIfAborted();
    return {
      ...report,
      items,
      notes,
      freeAfter: await options.freeSpace(measurementPath),
      finishedAt: DateTime.formatIso(DateTime.makeUnsafe(options.now())),
    };
  };
  const execute = async (
    report: MachineCleanupReport,
    settings: MachineCleanupSettings,
    phases: readonly MachineCleanupItem["phase"][],
    ids: readonly string[],
    signal: AbortSignal,
    progress: (target: string) => void,
  ): Promise<MachineCleanupReport> => {
    const notes = [...report.notes];
    const rows: MachineCleanupItem[] = [];
    const run = (command: string, args: readonly string[], cwd = options.home) =>
      options.command(cwd, command, args, signal);
    for (const row of report.items) {
      signal.throwIfAborted();
      if (
        row.outcome !== "pending" ||
        !phases.includes(row.phase) ||
        (row.phase !== "A" && !ids.includes(row.id))
      ) {
        rows.push(row);
        continue;
      }
      progress(row.path);
      try {
        if (row.phase === "A" && !machineRuleEnabled(settings, row.rule))
          throw new Error("Rule was disabled");
        const processes = cleanupBuildProcesses(await run("ps", ["-axo", "pid=,pcpu=,args="]));
        const rule: MachineCacheRule | undefined =
          row.rule.startsWith("rustup:") && /^[A-Za-z0-9._-]+$/.test(row.rule.slice(7))
            ? {
                id: row.rule,
                phase: "C",
                relativePath: `.rustup/toolchains/${row.rule.slice(7)}`,
                effect: row.effect,
                command: ["rustup", "toolchain", "uninstall", row.rule.slice(7)] as const,
              }
            : machineCacheRules(options.platform).find((entry) => entry.id === row.rule);
        if (
          row.phase === "A" &&
          processes.some((entry) => entry.busy) &&
          (row.project || row.rule === "derived-data" || rule?.gradle)
        )
          throw new Error("Active build; skipped");
        if (rule?.gradle) {
          if (row.phase === "C") await run("gradle", ["--stop"]);
          const current = cleanupBuildProcesses(await run("ps", ["-axo", "pid=,pcpu=,args="]));
          if (current.some((entry) => /gradle/i.test(entry.command)))
            throw new Error("Gradle processes remain; skipped");
        }
        if (row.rule === "worktree") {
          if (
            (await options.activeWorktrees()).some(
              (active) => active === row.path || active.startsWith(`${row.path}${NodePath.sep}`),
            )
          )
            throw new Error("T3 thread became active");
          const head = (await run("git", ["rev-parse", "HEAD"], row.path)).trim();
          const status = await run(
            "git",
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            row.path,
          );
          if (head !== row.head || status !== "")
            throw new Error("Worktree changed or has uncommitted work");
          await deleteCleanupPath(
            row.path,
            scopeFor(settings, [row.path]),
            async (target) => {
              const verified = await assessCleanupWorktrees({
                repository: row.project,
                signal,
                now: options.now(),
                exists,
                runner: {
                  git: (cwd, args) => run("git", args, cwd),
                  mergedPullRequests: async (cwd, branch) => {
                    const values: unknown = JSON.parse(
                      await run(
                        "gh",
                        [
                          "pr",
                          "list",
                          "--head",
                          branch,
                          "--state",
                          "merged",
                          "--json",
                          "headRefOid",
                          "--limit",
                          "100",
                        ],
                        cwd,
                      ),
                    );
                    return Array.isArray(values)
                      ? values.filter(
                          (value): value is { headRefOid: string } =>
                            typeof value === "object" &&
                            value !== null &&
                            "headRefOid" in value &&
                            typeof value.headRefOid === "string",
                        )
                      : [];
                  },
                },
                createdAt: async () => null,
                active: async (candidate) => (await options.activeWorktrees()).includes(candidate),
              });
              if (
                !verified.some(
                  (entry) =>
                    entry.worktree.path === target &&
                    entry.outcome === "candidate" &&
                    entry.worktree.head === row.head &&
                    entry.worktree.branch === row.branch,
                )
              )
                throw new Error("Worktree merge or ownership changed");
              if (
                (await run(
                  "git",
                  ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                  target,
                )) !== ""
              )
                throw new Error("Worktree changed");
              await run("git", ["worktree", "remove", target], row.project);
              await run("git", ["worktree", "prune"], row.project);
            },
            signal,
          );
        } else {
          if (row.project) {
            const current = await scanMachineProjects({
              scope: scopeFor(settings),
              now: options.now(),
              inactivityDays: settings.inactivityDays,
              signal,
              progress: () => {},
              activeBuild: async () => processes.some((entry) => entry.busy),
              lastCommit: async (cwd) => {
                try {
                  await run("git", ["rev-parse", "--git-dir"], cwd);
                } catch {
                  return null;
                }
                return Number((await run("git", ["log", "-1", "--format=%ct"], cwd)).trim()) * 1000;
              },
            });
            if (
              !current.candidates.some(
                (candidate) =>
                  candidate.path === row.path &&
                  candidate.rule === row.rule &&
                  candidate.phase === row.phase,
              )
            )
              throw new Error("Candidate is no longer eligible");
          }
          const command = rule?.command;
          await deleteCleanupPath(
            row.path,
            scopeFor(settings, row.project ? [] : [row.path]),
            command
              ? async () => {
                  if (row.rule === "simulator-data")
                    await run("xcrun", ["simctl", "shutdown", "all"]);
                  const args =
                    row.rule === "npm"
                      ? [...command.slice(1), "--cache", row.path]
                      : row.rule === "pnpm-prune"
                        ? [...command.slice(1), "--store-dir", row.path]
                        : command.slice(1);
                  await run(command[0], args);
                }
              : undefined,
            signal,
          );
        }
        rows.push({ ...row, outcome: "removed", reason: "Completed" });
      } catch {
        signal.throwIfAborted();
        rows.push({
          ...row,
          outcome: "skipped",
          reason: "Re-verification, guard or command failed; retained remaining files",
        });
        notes.push(`Skipped ${row.path}; it may be active, protected or partly in use`);
      }
    }
    return {
      ...report,
      items: rows,
      notes,
      freeAfter: await options.freeSpace(report.measurementPath),
      finishedAt: DateTime.formatIso(DateTime.makeUnsafe(options.now())),
    };
  };
  const notified = new Set<string>();
  const notify = async (
    report: MachineCleanupReport,
    settings: MachineCleanupSettings,
    signal: AbortSignal,
  ): Promise<MachineCleanupReport> => {
    const message = cleanupNotification(report, settings.lowSpaceGiB);
    if (!message || notified.has(report.id)) return report;
    notified.add(report.id);
    if (notified.size > 100) notified.delete(notified.values().next().value!);
    try {
      if (options.platform === "darwin")
        await options.command(
          options.home,
          "osascript",
          ["-e", `display notification ${JSON.stringify(message)} with title "Machine cleanup"`],
          signal,
        );
      else await options.command(options.home, "notify-send", ["Machine cleanup", message], signal);
      return report;
    } catch {
      signal.throwIfAborted();
      return {
        ...report,
        notes: [
          ...report.notes,
          "Notification not sent: the environment's native notification channel is unavailable",
        ],
      };
    }
  };
  return { scan, execute, notify };
}
