// @effect-diagnostics nodeBuiltinImport:off - Fixtures exercise native filesystem and Git behavior in temporary directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import {
  assessCleanupWorktrees,
  cleanupDefaultBranch,
  parseCleanupWorktrees,
  reverifyCleanupWorktree,
} from "./machineCleanupWorktrees.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const git = async (cwd: string, args: readonly string[]) =>
  (
    await exec("git", [...args], {
      cwd,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
        ),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
  ).stdout;

async function fixture() {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-cleanup-git-")),
  );
  const repository = NodePath.join(root, "main");
  const remote = NodePath.join(root, "remote.git");
  await NodeFSP.mkdir(repository);
  await git(root, ["init", "--bare", remote]);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.email", "fixture@example.invalid"]);
  await git(repository, ["config", "user.name", "Fixture"]);
  await NodeFSP.writeFile(NodePath.join(repository, "source"), "fixture");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "fixture"]);
  await git(repository, ["remote", "add", "origin", remote]);
  await git(repository, ["push", "-u", "origin", "main"]);
  return {
    root,
    repository,
    async [Symbol.asyncDispose]() {
      await NodeFSP.rm(root, { recursive: true, force: true });
    },
  };
}

it("parses NUL-delimited worktree paths without treating embedded newlines as records", () => {
  expect(
    parseCleanupWorktrees("worktree /tmp/a\nb\0HEAD abc\0branch refs/heads/topic\0\0"),
  ).toEqual([{ path: "/tmp/a\nb", head: "abc", branch: "topic", bare: false, locked: false }]);
});

it("classifies merged, dirty, active and default worktrees and rechecks changed candidates", async () => {
  await using f = await fixture();
  const linked = NodePath.join(f.root, "topic");
  await git(f.repository, ["worktree", "add", "-b", "topic", linked]);
  const input = {
    repository: f.repository,
    runner: { git, mergedPullRequests: async () => [] },
    now: Date.UTC(2026, 10, 11),
    createdAt: async () => Date.UTC(2026, 10, 10),
    exists: async (target: string) =>
      NodeFSP.stat(target).then(
        () => true,
        () => false,
      ),
    active: async () => false,
    signal: new AbortController().signal,
  };
  const results = await assessCleanupWorktrees(input);
  expect(results.map((r) => r.outcome)).toEqual(["keep", "candidate"]);
  expect(results[1]?.probablyActive).toBe(true);
  const approved = results[1]!.worktree;
  expect(await reverifyCleanupWorktree(input, approved)).not.toBeNull();
  await NodeFSP.writeFile(NodePath.join(linked, "unsaved"), "work");
  const dirty = await assessCleanupWorktrees(input);
  expect(dirty[1]).toMatchObject({ outcome: "dirty", changes: 1 });
  expect(await reverifyCleanupWorktree(input, approved)).toBeNull();
  expect((await assessCleanupWorktrees({ ...input, active: async () => true }))[1]?.outcome).toBe(
    "active",
  );
  expect(await NodeFSP.readFile(NodePath.join(linked, "unsaved"), "utf8")).toBe("work");
});

it("falls back from broken origin/HEAD and prunes missing worktree entries", async () => {
  await using f = await fixture();
  await git(f.repository, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/missing",
  ]);
  const runner = { git, mergedPullRequests: async () => [] };
  expect(await cleanupDefaultBranch(runner, f.repository)).toBe("refs/remotes/origin/main");
  const linked = NodePath.join(f.root, "stale");
  await git(f.repository, ["worktree", "add", "-b", "stale", linked]);
  await NodeFSP.rm(linked, { recursive: true });
  const results = await assessCleanupWorktrees({
    repository: f.repository,
    runner,
    now: 0,
    createdAt: async () => null,
    exists: async (target) =>
      NodeFSP.stat(target).then(
        () => true,
        () => false,
      ),
    active: async () => false,
    signal: new AbortController().signal,
  });
  expect(results[1]?.outcome).toBe("stale");
  expect(
    parseCleanupWorktrees(await git(f.repository, ["worktree", "list", "--porcelain", "-z"])),
  ).toHaveLength(1);
});

it("accepts squash merges only when the merged PR has this exact local HEAD", async () => {
  await using f = await fixture();
  const linked = NodePath.join(f.root, "squashed");
  await git(f.repository, ["worktree", "add", "-b", "squashed", linked]);
  await NodeFSP.writeFile(NodePath.join(linked, "new-source"), "fixture");
  await git(linked, ["add", "."]);
  await git(linked, ["commit", "-m", "topic"]);
  const head = (await git(linked, ["rev-parse", "HEAD"])).trim();
  const input = {
    repository: f.repository,
    now: Date.UTC(2026, 10, 11),
    createdAt: async () => null,
    exists: async () => true,
    active: async () => false,
    signal: new AbortController().signal,
  };
  expect(
    (
      await assessCleanupWorktrees({
        ...input,
        runner: { git, mergedPullRequests: async () => [{ headRefOid: "other" }] },
      })
    )[1]?.outcome,
  ).toBe("keep");
  expect(
    (
      await assessCleanupWorktrees({
        ...input,
        runner: { git, mergedPullRequests: async () => [{ headRefOid: head }] },
      })
    )[1],
  ).toMatchObject({ outcome: "candidate", probablyActive: false });
});
