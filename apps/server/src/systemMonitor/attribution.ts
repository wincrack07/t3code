import type {
  MachineProcess,
  MachineProcessSnapshot,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { attributeProjects } from "./parsers.ts";

const normalize = (path: string) => path.replace(/\/+$/, "") || "/";
const contains = (root: string, cwd: string) =>
  cwd === root || cwd.startsWith(root === "/" ? root : `${root}/`);

export function attributeProcesses(
  processes: readonly MachineProcess[],
  serverPid: number,
  threads: readonly { id: ThreadId; title: string; projectId: ProjectId; path: string }[],
  roots: readonly { id: string; title: string; path: string }[],
) {
  const byParent = new Map<number, MachineProcess[]>();
  for (const p of processes) {
    const children = byParent.get(p.ppid) ?? [];
    children.push(p);
    byParent.set(p.ppid, children);
  }
  const byDirectory = new Map<string, (typeof threads)[number][]>();
  for (const thread of threads) {
    const path = normalize(thread.path);
    const group = byDirectory.get(path) ?? [];
    group.push(thread);
    byDirectory.set(path, group);
  }
  const directories = [...byDirectory.keys()].sort((a, b) => b.length - a.length);
  const totals = new Map<ThreadId, MachineProcessSnapshot["threads"][number]>();
  const resolvedCwds = new Map<number, string | null>();
  const pending = (byParent.get(serverPid) ?? []).map((p) => ({ p, cwd: null as string | null }));
  const visited = new Set([serverPid]);
  while (pending.length) {
    const { p, cwd: inherited } = pending.pop()!;
    if (visited.has(p.pid)) continue;
    visited.add(p.pid);
    const cwd = p.cwd === null ? inherited : normalize(p.cwd);
    resolvedCwds.set(p.pid, cwd);
    for (const child of byParent.get(p.pid) ?? []) pending.push({ p: child, cwd });
    if (cwd === null) continue;
    const directory = directories.find((root) => contains(root, cwd));
    if (directory === undefined) continue;
    const owners = byDirectory.get(directory)!;
    for (const thread of owners) {
      if (owners.length > 1) {
        totals.set(thread.id, {
          id: thread.id,
          title: thread.title,
          projectId: thread.projectId,
          attribution: "shared-directory",
          rss: null,
          cpu: null,
          count: null,
        });
      } else {
        const group = totals.get(thread.id) ?? {
          id: thread.id,
          title: thread.title,
          projectId: thread.projectId,
          attribution: "cwd",
          rss: 0,
          cpu: 0,
          count: 0,
        };
        totals.set(thread.id, {
          ...group,
          rss: (group.rss ?? 0) + p.rss,
          cpu: (group.cpu ?? 0) + p.cpu,
          count: (group.count ?? 0) + 1,
        });
      }
    }
  }
  return {
    projects: attributeProjects(
      processes.map((p) => ({ ...p, cwd: resolvedCwds.get(p.pid) ?? p.cwd })),
      roots,
    ),
    threads: [...totals.values()].sort((a, b) => (b.rss ?? 0) - (a.rss ?? 0)),
  };
}
