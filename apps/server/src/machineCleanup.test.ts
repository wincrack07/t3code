// @effect-diagnostics nodeBuiltinImport:off - Fixtures exercise native filesystem and Git behavior in temporary directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  allocatedCleanupBytes,
  deleteCleanupPath,
  scanMachineProjects,
  UnsafeCleanupPath,
  verifyCleanupPath,
} from "./machineCleanup.ts";

async function fixture() {
  const home = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-machine-cleanup-")),
  );
  const root = NodePath.join(home, "projects");
  await NodeFSP.mkdir(root);
  const scope = { home, t3Home: NodePath.join(home, ".t3"), roots: [root], protectedPaths: [] };
  return {
    home,
    root,
    scope,
    async [Symbol.asyncDispose]() {
      await NodeFSP.rm(home, { recursive: true, force: true });
    },
  };
}

async function directory(target: string) {
  await NodeFSP.mkdir(target, { recursive: true });
  return target;
}

const now = Date.UTC(2026, 10, 11);
const old = now - 10 * 86_400_000;

async function scan(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    activeBuild?: boolean;
    commit?: number | null;
  } = {},
) {
  return scanMachineProjects({
    scope: f.scope,
    now,
    inactivityDays: 7,
    signal: new AbortController().signal,
    lastCommit: async () => options.commit ?? null,
    activeBuild: async () => options.activeBuild ?? false,
    progress: () => {},
  });
}

describe("machine cleanup path boundary", () => {
  it("rejects empty, relative, root, home, scope roots and outside paths", async () => {
    await using f = await fixture();
    for (const target of ["", "relative", "/", f.home, f.root, NodePath.join(f.home, "outside")]) {
      await expect(verifyCleanupPath(target, f.scope)).rejects.toBeInstanceOf(UnsafeCleanupPath);
    }
    const cache = await directory(NodePath.join(f.root, "app", ".next"));
    expect(await verifyCleanupPath(cache, f.scope)).toBe(cache);
  });

  it("protects T3 data, agent history, environment files and custom paths even with broad scopes", async () => {
    await using f = await fixture();
    const scope = { ...f.scope, roots: [f.home], protectedPaths: [NodePath.join(f.home, "keep")] };
    for (const name of [
      ".t3/userdata",
      ".claude",
      ".codex/sessions",
      ".codex/thread_history.jsonl",
      ".local/bin",
      ".local/share/opencode",
      ".local/share/aws-cli",
      ".local/share/personal-cv",
      "keep/nested",
      "project/.env",
      "project/.env.local",
    ]) {
      const target = await directory(NodePath.join(f.home, name));
      await expect(deleteCleanupPath(target, scope)).rejects.toBeInstanceOf(UnsafeCleanupPath);
      expect((await NodeFSP.stat(target)).isDirectory()).toBe(true);
    }
  });

  it("rejects symlinks escaping scope and linked protected ancestors", async () => {
    await using f = await fixture();
    const outside = await directory(NodePath.join(f.home, "outside"));
    const link = NodePath.join(f.root, "link");
    await NodeFSP.symlink(outside, link);
    await expect(deleteCleanupPath(link, f.scope)).rejects.toBeInstanceOf(UnsafeCleanupPath);
    await expect(deleteCleanupPath(NodePath.join(link, "missing"), f.scope)).rejects.toBeInstanceOf(
      UnsafeCleanupPath,
    );
    const cache = await directory(NodePath.join(f.root, "cache"));
    await NodeFSP.symlink(outside, NodePath.join(cache, "linked"));
    await expect(deleteCleanupPath(cache, f.scope)).rejects.toBeInstanceOf(UnsafeCleanupPath);
    expect((await NodeFSP.stat(outside)).isDirectory()).toBe(true);
  });

  it("checks children before deletion and removes only regenerable fixture data", async () => {
    await using f = await fixture();
    const cache = await directory(NodePath.join(f.root, "cache"));
    await NodeFSP.writeFile(NodePath.join(cache, ".env"), "fixture");
    await expect(deleteCleanupPath(cache, f.scope)).rejects.toBeInstanceOf(UnsafeCleanupPath);
    expect(await NodeFSP.readFile(NodePath.join(cache, ".env"), "utf8")).toBe("fixture");
    const safe = await directory(NodePath.join(f.root, "safe"));
    await NodeFSP.writeFile(NodePath.join(safe, "generated"), "fixture");
    await deleteCleanupPath(safe, f.scope);
    await expect(NodeFSP.stat(safe)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("machine cleanup project rules", () => {
  it("requires language markers and leaves recent builds untouched", async () => {
    await using f = await fixture();
    const flutter = await directory(NodePath.join(f.root, "flutter"));
    const node = await directory(NodePath.join(f.root, "node"));
    const unrelated = await directory(NodePath.join(f.root, "other"));
    await NodeFSP.writeFile(NodePath.join(flutter, "pubspec.yaml"), "name: fixture");
    await NodeFSP.writeFile(NodePath.join(node, "package.json"), "{}");
    for (const project of [flutter, node, unrelated]) {
      for (const name of ["build", ".dart_tool", ".next", ".turbo"]) {
        const target = await directory(NodePath.join(project, name));
        await NodeFSP.utimes(target, old / 1000, old / 1000);
      }
    }
    expect((await scan(f)).candidates.map((c) => c.path).sort()).toEqual(
      [
        NodePath.join(flutter, "build"),
        NodePath.join(flutter, ".dart_tool"),
        NodePath.join(node, ".next"),
        NodePath.join(node, ".turbo"),
      ].sort(),
    );
    await NodeFSP.utimes(NodePath.join(flutter, "build"), now / 1000, now / 1000);
    const recent = await scan(f);
    expect(recent.candidates.filter((c) => c.project === flutter)).toEqual([]);
    expect(recent.skipped.filter((c) => c.path.startsWith(flutter))).toHaveLength(2);
    const busy = await scan(f, { activeBuild: true });
    expect(busy.candidates).toEqual([]);
    expect(busy.skipped).toHaveLength(4);
  });

  it("requires old source and commit dates and excludes nested, bundled and symlink modules", async () => {
    await using f = await fixture();
    const app = await directory(NodePath.join(f.root, "app"));
    const source = NodePath.join(app, "index.ts");
    await NodeFSP.writeFile(source, "fixture");
    await NodeFSP.utimes(source, old / 1000, old / 1000);
    await directory(NodePath.join(app, "node_modules", "nested", "node_modules"));
    await directory(NodePath.join(app, "ios", "Pods"));
    const result = await scan(f, { commit: old });
    expect(result.candidates.map((c) => c.path).sort()).toEqual(
      [NodePath.join(app, "node_modules"), NodePath.join(app, "ios", "Pods")].sort(),
    );
    expect((await scan(f, { commit: now })).candidates).toEqual([]);
    await NodeFSP.utimes(source, now / 1000, now / 1000);
    expect((await scan(f)).candidates).toEqual([]);
    const bundled = await directory(NodePath.join(f.root, ".local", "runtime", "node-22"));
    await directory(NodePath.join(bundled, "node_modules"));
    await NodeFSP.writeFile(NodePath.join(bundled, "index.js"), "fixture");
    await NodeFSP.utimes(NodePath.join(bundled, "index.js"), old / 1000, old / 1000);
    const linked = await directory(NodePath.join(f.root, "linked"));
    await NodeFSP.writeFile(NodePath.join(linked, "index.js"), "fixture");
    await NodeFSP.utimes(NodePath.join(linked, "index.js"), old / 1000, old / 1000);
    await NodeFSP.symlink(
      NodePath.join(app, "node_modules"),
      NodePath.join(linked, "node_modules"),
    );
    expect((await scan(f)).candidates).toEqual([]);
  });

  it("cancels traversal and uses allocated bytes for sparse files", async () => {
    await using f = await fixture();
    const sparse = NodePath.join(f.root, "Docker.raw");
    await NodeFSP.writeFile(sparse, "fixture");
    await NodeFSP.truncate(sparse, 1024 ** 3);
    expect(await allocatedCleanupBytes(sparse)).toBe((await NodeFSP.stat(sparse)).blocks * 512);
    const controller = new AbortController();
    controller.abort();
    await expect(
      scanMachineProjects({
        scope: f.scope,
        now,
        inactivityDays: 7,
        signal: controller.signal,
        lastCommit: async () => null,
        activeBuild: async () => false,
        progress: () => {},
      }),
    ).rejects.toThrow();
  });
});
