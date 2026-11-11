// @effect-diagnostics nodeBuiltinImport:off - This low-level Node adapter preserves native realpath and allocated-block semantics.
import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export interface CleanupScope {
  readonly home: string;
  readonly t3Home: string;
  readonly roots: readonly string[];
  readonly protectedPaths: readonly string[];
}

const contains = (root: string, target: string) => {
  const relative = NodePath.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
};

const protectedNames = [
  ".claude",
  ".codex/sessions",
  ".local/share/opencode",
  ".local/share/aws-cli",
  ".local/share/personal-cv",
  ".local/bin",
  ".t3",
];

export class UnsafeCleanupPath extends Schema.TaggedError<UnsafeCleanupPath>()(
  "UnsafeCleanupPath",
  {
    target: Schema.String,
  },
) {
  override get message(): string {
    return "Machine cleanup refused an unsafe path";
  }
}

async function canonical(target: string): Promise<string> {
  try {
    return await NodeFSP.realpath(target);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const parent = NodePath.dirname(target);
    if (parent === target) throw error;
    return NodePath.join(await canonical(parent), NodePath.basename(target));
  }
}

export async function verifyCleanupPath(target: string, scope: CleanupScope): Promise<string> {
  if (!target || !NodePath.isAbsolute(target) || NodePath.normalize(target) !== target)
    throw new UnsafeCleanupPath({ target });
  const home = await canonical(scope.home);
  const resolved = await canonical(target);
  const roots = await Promise.all(scope.roots.map(canonical));
  const denied = await Promise.all(
    [
      scope.t3Home,
      "/System",
      "/bin",
      "/sbin",
      "/usr",
      "/etc",
      "/proc",
      "/sys",
      "/dev",
      "/boot",
      "/private/var/vm",
      "/var/lib",
      "/var/log",
      "/Library",
      ...protectedNames.map((name) => NodePath.join(scope.home, name)),
      ...scope.protectedPaths,
    ].map(canonical),
  );
  const forbidden = (value: string) =>
    value === NodePath.parse(value).root ||
    value === home ||
    denied.some((root) => contains(root, value) || contains(value, root)) ||
    value
      .split(NodePath.sep)
      .some(
        (part) => part === ".env" || part.startsWith(".env.") || part.startsWith("thread_history"),
      );
  if (
    forbidden(target) ||
    forbidden(resolved) ||
    !roots.some((root) => contains(root, resolved) && root !== resolved)
  ) {
    throw new UnsafeCleanupPath({ target });
  }
  if (resolved !== target) throw new UnsafeCleanupPath({ target });
  return resolved;
}

export async function deleteCleanupPath(target: string, scope: CleanupScope): Promise<void> {
  const resolved = await verifyCleanupPath(target, scope);
  // Reject links throughout the tree, including links to protected files inside an allowed cache.
  const pending = [resolved];
  const checked: string[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    await verifyCleanupPath(current, scope);
    const stat = await NodeFSP.lstat(current);
    if (stat.isSymbolicLink()) throw new UnsafeCleanupPath({ target: current });
    checked.push(current);
    if (stat.isDirectory()) {
      for (const name of await NodeFSP.readdir(current)) pending.push(NodePath.join(current, name));
    }
  }
  for (const current of checked.reverse()) {
    await verifyCleanupPath(current, scope);
    const stat = await NodeFSP.lstat(current);
    if (stat.isSymbolicLink()) throw new UnsafeCleanupPath({ target: current });
    if (stat.isDirectory()) await NodeFSP.rmdir(current);
    else await NodeFSP.unlink(current);
  }
}

export interface MachineCleanupCandidate {
  readonly path: string;
  readonly project: string;
  readonly phase: "A" | "B";
  readonly rule: "flutter-build" | "flutter-tool" | "next" | "turbo" | "node-modules" | "pods";
  readonly bytes: number;
  readonly modifiedAt: number;
}

const sourcePattern = /\.(?:ts|tsx|js|dart|json|py)$/;
const sourcePrunes = new Set(["node_modules", "build", ".next", ".dart_tool", ".git", "Pods"]);
const day = 86_400_000;

async function exists(target: string) {
  try {
    await NodeFSP.access(target);
    return true;
  } catch {
    return false;
  }
}

async function newestCleanupSource(project: string, signal: AbortSignal): Promise<number> {
  let newest = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
      signal.throwIfAborted();
      if (entry.isSymbolicLink() || sourcePrunes.has(entry.name)) continue;
      const target = NodePath.join(directory, entry.name);
      if (entry.isDirectory() && depth < 2) await visit(target, depth + 1);
      else if (entry.isFile() && sourcePattern.test(entry.name))
        newest = Math.max(newest, (await NodeFSP.stat(target)).mtimeMs);
    }
  };
  await visit(project, 0);
  return newest;
}

export async function allocatedCleanupBytes(target: string, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const stat = await NodeFSP.lstat(target);
  if (stat.isSymbolicLink()) return 0;
  let bytes = stat.blocks * 512;
  if (stat.isDirectory()) {
    for (const name of await NodeFSP.readdir(target))
      bytes += await allocatedCleanupBytes(NodePath.join(target, name), signal);
  }
  return bytes;
}

export async function scanMachineProjects(input: {
  readonly scope: CleanupScope;
  readonly now: number;
  readonly inactivityDays: number;
  readonly signal: AbortSignal;
  readonly lastCommit: (project: string) => Promise<number | null>;
  readonly activeBuild: (project: string) => Promise<boolean>;
  readonly progress: (directory: string) => void;
}): Promise<{
  candidates: MachineCleanupCandidate[];
  skipped: { path: string; reason: string }[];
}> {
  if (
    !Number.isFinite(input.now) ||
    !Number.isFinite(input.inactivityDays) ||
    input.inactivityDays < 1
  ) {
    throw new RangeError("Machine cleanup needs a valid clock and positive inactivity days");
  }
  const candidates: MachineCleanupCandidate[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  const cutoff = input.now - input.inactivityDays * day;
  const visit = async (directory: string, depth: number): Promise<void> => {
    input.signal.throwIfAborted();
    if (seen.has(directory)) return;
    seen.add(directory);
    input.progress(directory);
    const entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const flutter = names.has("pubspec.yaml");
    const node = names.has("package.json");
    const rules = [
      { name: "build", enabled: flutter, rule: "flutter-build", phase: "A" },
      { name: ".dart_tool", enabled: flutter, rule: "flutter-tool", phase: "A" },
      { name: ".next", enabled: node, rule: "next", phase: "A" },
      { name: ".turbo", enabled: node, rule: "turbo", phase: "A" },
      { name: "node_modules", enabled: true, rule: "node-modules", phase: "B" },
      { name: "ios/Pods", enabled: true, rule: "pods", phase: "B" },
    ] as const;
    for (const rule of rules) {
      if (!rule.enabled || depth + rule.name.split("/").length > 7) continue;
      const target = NodePath.join(directory, rule.name);
      if (!(await exists(target))) continue;
      try {
        await verifyCleanupPath(target, input.scope);
      } catch {
        skipped.push({ path: target, reason: "Protected or symlinked path" });
        continue;
      }
      const stat = await NodeFSP.lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const buildModifiedAt =
        (await NodeFSP.stat(NodePath.join(directory, "build")).catch(() => null))?.mtimeMs ?? 0;
      if (
        rule.phase === "A" &&
        ((await input.activeBuild(directory)) || buildModifiedAt > input.now - 30 * 60_000)
      ) {
        skipped.push({ path: target, reason: "Active or recently modified build" });
        continue;
      }
      if (rule.phase === "B") {
        if (directory.includes(`${NodePath.sep}.local${NodePath.sep}runtime${NodePath.sep}`))
          continue;
        const newest = await newestCleanupSource(directory, input.signal);
        const committed = await input.lastCommit(directory);
        if (newest === 0 || newest >= cutoff || (committed !== null && committed >= cutoff))
          continue;
      }
      candidates.push({
        path: target,
        project: directory,
        phase: rule.phase,
        rule: rule.rule,
        bytes: await allocatedCleanupBytes(target, input.signal),
        modifiedAt: stat.mtimeMs,
      });
    }
    if (depth >= 7) return;
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        sourcePrunes.has(entry.name) ||
        entry.name === ".turbo"
      )
        continue;
      const target = NodePath.join(directory, entry.name);
      try {
        await verifyCleanupPath(target, input.scope);
      } catch {
        continue;
      }
      await visit(target, depth + 1);
    }
  };
  for (const root of input.scope.roots) {
    if (await exists(root)) await visit(await canonical(root), 0);
  }
  return { candidates, skipped };
}
