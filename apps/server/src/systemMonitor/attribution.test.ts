import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type MachineProcess } from "@t3tools/contracts";
import { attributeProcesses } from "./attribution.ts";

it("attributes server descendants by nearest cwd, keeps shared directories unknown and excludes unrelated trees", () => {
  const projectId = ProjectId.make("app");
  const otherProjectId = ProjectId.make("other");
  const thread = (id: string, path: string, project = projectId) => ({
    id: ThreadId.make(id),
    title: id,
    projectId: project,
    path,
  });
  const process = (
    pid: number,
    ppid: number,
    cwd: string | null,
    rss = 10,
    cpu = 25,
  ): MachineProcess => ({ pid, ppid, cwd, rss, cpu, name: "node", owner: null });
  const roots = [
    { id: projectId, title: "App", path: "/app" },
    { id: projectId, title: "App", path: "/worktrees/one" },
    { id: projectId, title: "App", path: "/worktrees/one/nested" },
    { id: otherProjectId, title: "Other", path: "/other" },
  ];
  const threads = [
    thread("one", "/worktrees/one/"),
    thread("nested", "/worktrees/one/nested"),
    thread("shared-a", "/app"),
    thread("shared-b", "/app/"),
    thread("other", "/other", otherProjectId),
  ];
  const result = attributeProcesses(
    [
      process(100, 1, "/other", 999), // The server's cwd must not leak to children without one.
      process(101, 100, "/worktrees/one", 20, 200),
      process(102, 101, null, 30, 50),
      process(103, 102, "/worktrees/one/nested/src", 40, 75),
      process(104, 103, null, 50, 100),
      process(105, 100, "/app/src", 60, 5),
      process(106, 105, null, 70, 10),
      process(107, 100, null, 888),
      process(108, 100, "/worktrees/one-other", 777),
      process(109, 100, "/other", 80, 15),
      process(201, 1, "/worktrees/one", 90, 20), // Same cwd, outside the server tree.
      process(202, 999, "/worktrees/one", 100, 30), // Missing parent.
      process(203, 204, "/worktrees/one", 110, 40),
      process(204, 203, "/worktrees/one", 120, 50), // Disconnected cycle.
    ],
    100,
    threads,
    roots,
  );
  expect(result.threads).toEqual([
    { id: "nested", title: "nested", projectId, attribution: "cwd", rss: 90, cpu: 175, count: 2 },
    {
      id: "other",
      title: "other",
      projectId: otherProjectId,
      attribution: "cwd",
      rss: 80,
      cpu: 15,
      count: 1,
    },
    { id: "one", title: "one", projectId, attribution: "cwd", rss: 50, cpu: 250, count: 2 },
    {
      id: "shared-a",
      title: "shared-a",
      projectId,
      attribution: "shared-directory",
      rss: null,
      cpu: null,
      count: null,
    },
    {
      id: "shared-b",
      title: "shared-b",
      projectId,
      attribution: "shared-directory",
      rss: null,
      cpu: null,
      count: null,
    },
  ]);
  expect(result.projects.find((p) => p.id === projectId)).toEqual({
    id: projectId,
    title: "App",
    rss: 690,
    cpu: 580,
    count: 10,
  });
  expect(
    attributeProcesses(
      [process(1, 0, "/app"), process(2, 1, null)],
      1,
      [thread("one", "/app")],
      roots,
    ).threads,
  ).toEqual([]);
});
