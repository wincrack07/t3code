// @effect-diagnostics nodeBuiltinImport:off - This low-level Node adapter preserves native realpath and allocated-block semantics.
import * as NodePath from "node:path";

export interface CleanupGitRunner {
  readonly git: (cwd: string, args: readonly string[]) => Promise<string>;
  readonly mergedPullRequests: (
    cwd: string,
    branch: string,
  ) => Promise<readonly { readonly headRefOid: string }[]>;
}

export interface CleanupWorktree {
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
}

export function parseCleanupWorktrees(output: string): CleanupWorktree[] {
  const entries: CleanupWorktree[] = [];
  for (const record of output.split("\0\0")) {
    const fields = record.split("\0");
    const target = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (!target || !NodePath.isAbsolute(target)) continue;
    entries.push({
      path: target,
      head: fields.find((field) => field.startsWith("HEAD "))?.slice(5) ?? "",
      branch: fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18) ?? null,
      bare: fields.includes("bare"),
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
    });
  }
  return entries;
}

export async function cleanupDefaultBranch(
  runner: CleanupGitRunner,
  cwd: string,
): Promise<string | null> {
  const symbolic = await runner
    .git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
    .catch(() => "");
  const options = [
    symbolic.trim(),
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
  ];
  for (const ref of [...new Set(options)].filter(Boolean)) {
    try {
      await runner.git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
      return ref;
    } catch {
      /* A broken symbolic origin/HEAD must not prevent the named fallbacks. */
    }
  }
  return null;
}

export interface CleanupWorktreeAssessment {
  readonly worktree: CleanupWorktree;
  readonly outcome: "candidate" | "dirty" | "active" | "keep" | "stale";
  readonly reason: string;
  readonly changes: number;
  readonly probablyActive: boolean;
}

export async function assessCleanupWorktrees(input: {
  readonly repository: string;
  readonly runner: CleanupGitRunner;
  readonly now: number;
  readonly createdAt: (target: string) => Promise<number | null>;
  readonly exists: (target: string) => Promise<boolean>;
  readonly active: (target: string) => Promise<boolean>;
  readonly signal: AbortSignal;
}): Promise<CleanupWorktreeAssessment[]> {
  const { runner, repository } = input;
  input.signal.throwIfAborted();
  await runner.git(repository, ["fetch", "--prune", "-q"]);
  const worktrees = parseCleanupWorktrees(
    await runner.git(repository, ["worktree", "list", "--porcelain", "-z"]),
  );
  const defaultRef = await cleanupDefaultBranch(runner, repository);
  const defaultHead = defaultRef
    ? (await runner.git(repository, ["rev-parse", defaultRef])).trim()
    : null;
  const defaultName = defaultRef?.replace(/^refs\/(?:remotes\/origin|heads)\//, "");
  const result: CleanupWorktreeAssessment[] = [];
  let stale = false;
  for (const [index, worktree] of worktrees.entries()) {
    input.signal.throwIfAborted();
    const record = (
      outcome: CleanupWorktreeAssessment["outcome"],
      reason: string,
      changes = 0,
      probablyActive = false,
    ) => {
      result.push({ worktree, outcome, reason, changes, probablyActive });
    };
    if (
      index === 0 ||
      worktree.bare ||
      worktree.locked ||
      !worktree.branch ||
      ["main", "master", defaultName].includes(worktree.branch)
    ) {
      record("keep", "Main, default, detached or locked worktree");
      continue;
    }
    if (!(await input.exists(worktree.path))) {
      stale = true;
      record("stale", "Missing worktree path");
      continue;
    }
    if (await input.active(worktree.path)) {
      record("active", "Owned by an unsettled thread or a running or queued turn");
      continue;
    }
    if (!defaultHead || !defaultRef) {
      record("keep", "No default branch found");
      continue;
    }
    let ancestor = false;
    try {
      await runner.git(repository, ["merge-base", "--is-ancestor", worktree.head, defaultHead]);
      ancestor = true;
    } catch {
      /* Git exits nonzero for non-ancestors. */
    }
    const merged =
      ancestor ||
      (await runner.mergedPullRequests(repository, worktree.branch).catch(() => [])).some(
        (pr) => pr.headRefOid === worktree.head,
      );
    if (!merged) {
      record("keep", "HEAD is not merged");
      continue;
    }
    const status = await runner.git(worktree.path, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    if (status !== "") {
      record(
        "dirty",
        "Uncommitted changes; never remove",
        status
          .split("\0")
          .filter(Boolean)
          .filter((entry) => /^.. /.test(entry)).length,
      );
      continue;
    }
    const createdAt = await input.createdAt(worktree.path);
    const probablyActive =
      ancestor &&
      (worktree.head === defaultHead ||
        (createdAt !== null && input.now - createdAt <= 2 * 86_400_000));
    record(
      "candidate",
      probablyActive ? "Probably active; recommend keeping" : "Merged and clean; requires approval",
      0,
      probablyActive,
    );
  }
  if (stale) await runner.git(repository, ["worktree", "prune"]);
  return result;
}

export async function reverifyCleanupWorktree(
  input: Parameters<typeof assessCleanupWorktrees>[0],
  approved: CleanupWorktree,
): Promise<CleanupWorktreeAssessment | null> {
  const assessment = (await assessCleanupWorktrees(input)).find(
    (entry) => entry.worktree.path === approved.path,
  );
  return assessment?.outcome === "candidate" &&
    assessment.worktree.head === approved.head &&
    assessment.worktree.branch === approved.branch
    ? assessment
    : null;
}
