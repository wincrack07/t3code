import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  ChatAttachmentId,
  EnvironmentId,
  ProjectId,
  type ProjectSavedPrompt,
  type ProjectTaskAttachment,
  SourceControlProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  adjacentTaskKey,
  buildTaskBoard,
  buildTaskList,
  buildTaskProjectGroups,
  findTaskGroupForProject,
  openTaskCount,
  pendingTaskLink,
  pickTaskHomeProject,
  taskAttachmentLimitError,
  taskAttachmentViews,
  taskListOrder,
  taskStartTargets,
  taskThreadRefs,
  taskStatusForDrop,
  taskThreadLink,
  taskThreadState,
} from "./tasks.logic";

const mac = EnvironmentId.make("mac");
const vpsA = EnvironmentId.make("vps-a");
const vpsB = EnvironmentId.make("vps-b");
const settings = {
  sidebarProjectGroupingMode: "repository" as const,
  sidebarProjectGroupingOverrides: {},
};

const identity = (name: string) => ({
  canonicalKey: `github.com/acme/${name}`,
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: `https://github.com/acme/${name}.git`,
  },
  provider: SourceControlProviderKind.make("github"),
  owner: "acme",
  name,
  displayName: name,
});

const task = (id: string, createdAt: string, extra: Partial<ProjectSavedPrompt> = {}) =>
  ({ id, text: `Prompt ${id}`, createdAt, completedAt: null, ...extra }) as ProjectSavedPrompt;

const project = (
  environmentId: EnvironmentId,
  repo: string,
  savedPrompts: ProjectSavedPrompt[] | undefined,
): EnvironmentProject => ({
  environmentId,
  id: ProjectId.make(`${repo}-${environmentId}`),
  title: repo,
  workspaceRoot: `/work/${environmentId}/${repo}`,
  repositoryIdentity: identity(repo),
  defaultModelSelection: null,
  scripts: [],
  ...(savedPrompts ? { savedPrompts } : {}),
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
});

const projects = [
  project(mac, "orbit", [task("m1", "2026-11-01T00:00:00Z")]),
  project(vpsA, "orbit", [
    task("a1", "2026-11-03T00:00:00Z"),
    task("a2", "2026-11-02T00:00:00Z", { status: "done", completedAt: "2026-11-04T00:00:00Z" }),
  ]),
  project(vpsB, "orbit", [task("b1", "2026-11-05T00:00:00Z")]),
  project(mac, "lumen", [task("l1", "2026-10-01T00:00:00Z", { status: "in-progress" })]),
];

describe("buildTaskProjectGroups", () => {
  it("unions one logical project's tasks across machines and leaves out unreachable ones", () => {
    const groups = buildTaskProjectGroups({
      projects,
      settings,
      primaryEnvironmentId: mac,
      connected: new Set([mac, vpsA]),
    });
    const orbit = groups.find((group) => group.label === "orbit")!;
    expect(orbit.tasks.map((entry) => entry.task.id)).toEqual(["a1", "a2", "m1"]);
    expect(orbit.tasks.map((entry) => entry.home.environmentId)).toEqual([vpsA, vpsA, mac]);
    expect(orbit.unreachable).toBe(1);
    expect(orbit.multiMachine).toBe(true);
    expect(openTaskCount(orbit)).toBe(2);

    // Every copy of the project resolves to the same group, so every window counts the same.
    for (const environmentId of [mac, vpsA, vpsB]) {
      expect(findTaskGroupForProject(groups, environmentId, `orbit-${environmentId}`)?.key).toBe(
        orbit.key,
      );
    }
    const lumen = groups.find((group) => group.label === "lumen")!;
    expect(lumen.multiMachine).toBe(false);
    expect(lumen.unreachable).toBe(0);
  });

  it("counts every machine's tasks once all are connected", () => {
    const groups = buildTaskProjectGroups({
      projects,
      settings,
      primaryEnvironmentId: mac,
      connected: new Set([mac, vpsA, vpsB]),
    });
    const orbit = groups.find((group) => group.label === "orbit")!;
    expect(openTaskCount(orbit)).toBe(3);
    expect(orbit.unreachable).toBe(0);
  });
});

describe("pickTaskHomeProject", () => {
  const labels: Record<string, string> = { mac: "Mac", "vps-a": "Alpha", "vps-b": "Beta" };
  const label = (environmentId: EnvironmentId) => labels[environmentId] ?? environmentId;
  const orbit = (connected: EnvironmentId[], list = projects) =>
    buildTaskProjectGroups({
      projects: list,
      settings,
      primaryEnvironmentId: mac,
      connected: new Set(connected),
    }).find((group) => group.label === "orbit")!;

  it("prefers the connected primary machine, then the first connected machine by label", () => {
    expect(pickTaskHomeProject(orbit([mac, vpsA, vpsB]), mac, label)?.environmentId).toBe(mac);
    expect(pickTaskHomeProject(orbit([vpsB, vpsA]), mac, label)?.environmentId).toBe(vpsA);
    expect(pickTaskHomeProject(orbit([]), mac, label)).toBeNull();
  });

  it("skips machines whose server does not store tasks", () => {
    const list = [project(mac, "orbit", undefined), project(vpsB, "orbit", [])];
    expect(pickTaskHomeProject(orbit([mac, vpsB], list), mac, label)?.environmentId).toBe(vpsB);
  });
});

describe("buildTaskList", () => {
  const groups = buildTaskProjectGroups({
    projects,
    settings,
    primaryEnvironmentId: mac,
    connected: new Set([mac, vpsA]),
  });

  it("splits open and done sections and counts unreachable machines once", () => {
    const list = buildTaskList(groups, null);
    expect(list.open.map((section) => [section.group.label, section.tasks.length])).toEqual([
      ["lumen", 1],
      ["orbit", 2],
    ]);
    expect(list.done.map((section) => section.tasks.map((entry) => entry.task.id))).toEqual([
      ["a2"],
    ]);
    expect([list.openCount, list.doneCount, list.unreachable, list.empty]).toEqual([3, 1, 1, null]);
    expect(taskListOrder(list, false)).toHaveLength(3);
    expect(taskListOrder(list, true)).toHaveLength(4);
  });

  it("filters to one logical project and explains an empty result", () => {
    const lumen = groups.find((group) => group.label === "lumen")!;
    expect(buildTaskList(groups, lumen.key).openCount).toBe(1);
    expect(buildTaskList(groups, lumen.key).unreachable).toBe(0);
    expect(buildTaskList(groups, "missing").empty).toBe("filtered");
    expect(buildTaskList([], null).empty).toBe("none");
  });
});

describe("list navigation", () => {
  it("moves within bounds and enters from either end", () => {
    const order = ["a", "b", "c"];
    expect(adjacentTaskKey(order, null, 1)).toBe("a");
    expect(adjacentTaskKey(order, null, -1)).toBe("c");
    expect(adjacentTaskKey(order, "b", 1)).toBe("c");
    expect(adjacentTaskKey(order, "c", 1)).toBe("c");
    expect(adjacentTaskKey(order, "a", -1)).toBe("a");
    expect(adjacentTaskKey(order, "gone", 1)).toBe("a");
    expect(adjacentTaskKey([], "a", 1)).toBeNull();
  });
});

describe("board", () => {
  const groups = buildTaskProjectGroups({
    projects,
    settings,
    primaryEnvironmentId: mac,
    connected: new Set([mac, vpsA, vpsB]),
  });

  it("places tasks by status, newest first, within the project filter", () => {
    const board = buildTaskBoard(groups, null);
    expect(board.open.map((entry) => entry.task.id)).toEqual(["b1", "a1", "m1"]);
    expect(board["in-progress"].map((entry) => entry.task.id)).toEqual(["l1"]);
    expect(board.done.map((entry) => entry.task.id)).toEqual(["a2"]);
    const orbitKey = groups.find((group) => group.label === "orbit")!.key;
    expect(buildTaskBoard(groups, orbitKey)["in-progress"]).toEqual([]);
  });

  it("changes status only for a drop on a different column", () => {
    expect(taskStatusForDrop({ status: "open" }, "done")).toBe("done");
    expect(taskStatusForDrop({ status: "open" }, "open")).toBeNull();
    expect(taskStatusForDrop({ status: "open" }, "task:abc")).toBeNull();
    expect(taskStatusForDrop({ status: "open" }, null)).toBeNull();
  });
});

describe("taskThreadState", () => {
  const linked = { latestThreadId: ThreadId.make("t1") };
  it("reads the linked thread's runtime", () => {
    expect(taskThreadState({}, null)).toBeNull();
    expect(taskThreadState(linked, null)).toBe("missing");
    expect(taskThreadState(linked, { runtime: { status: "running" } } as never)).toBe("running");
    expect(taskThreadState(linked, { runtime: null } as never)).toBe("finished");
  });
});

describe("taskThreadLink", () => {
  it("builds the /new link and refuses prompts the link parser would reject", () => {
    const link = taskThreadLink("Fix the build", "https://app.example.test");
    expect(link).toBe("https://app.example.test/new?prompt=Fix+the+build");
    expect(taskThreadLink("x".repeat(8_000))).not.toBeNull();
    expect(taskThreadLink("x".repeat(8_001))).toBeNull();
  });
});

const MIB = 1024 * 1024;
const storedImage = (id: string, sizeBytes: number): ProjectTaskAttachment => ({
  kind: "stored",
  attachment: {
    type: "image",
    id: ChatAttachmentId.make(id),
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes,
  },
});
const reference = (path: string, extra: Partial<ProjectTaskAttachment> = {}) =>
  ({ kind: "reference", path, temporary: false, ...extra }) as ProjectTaskAttachment;

describe("taskAttachmentLimitError", () => {
  it("enforces the count and per-kind size limits before uploading", () => {
    const seven = Array.from({ length: 7 }, (_, index) => reference(`/r/${index}`));
    expect(taskAttachmentLimitError(seven, [{ name: "a", kind: "path", sizeBytes: 0 }])).toBeNull();
    expect(
      taskAttachmentLimitError(seven, [
        { name: "a", kind: "path", sizeBytes: 0 },
        { name: "b", kind: "path", sizeBytes: 0 },
      ]),
    ).toBe("A task holds up to 8 attachments. There is room for 1 more.");
    expect(
      taskAttachmentLimitError(
        [...seven, reference("/r/8")],
        [{ name: "a", kind: "path", sizeBytes: 0 }],
      ),
    ).toBe("A task holds up to 8 attachments. Remove one to add another.");
    expect(
      taskAttachmentLimitError([], [{ name: "shot.png", kind: "image", sizeBytes: 10 * MIB + 1 }]),
    ).toBe("shot.png is larger than the 10 MiB image limit.");
    expect(
      taskAttachmentLimitError([], [{ name: "log.txt", kind: "file", sizeBytes: 50 * MIB + 1 }]),
    ).toBe("log.txt is larger than the 50 MiB file limit.");
  });
});

describe("taskAttachmentViews", () => {
  const label = (environmentId: EnvironmentId) => (environmentId === mac ? "Mac" : "Alpha");
  it("shows stored copies, references with per-machine state, and temp-folder warnings", () => {
    const views = taskAttachmentViews({
      attachments: [
        storedImage("shot", 2048),
        reference("/work/orbit/src/"),
        reference("/tmp/build", { temporary: true }),
      ],
      inspected: [
        {
          key: "/work/orbit/src/",
          missing: false,
          sizeBytes: 0,
          isDirectory: true,
          warning: null,
          referenceStates: [
            { environmentId: mac, state: "ok" },
            { environmentId: vpsA, state: "missing" },
          ],
        },
        {
          key: "/tmp/build",
          missing: true,
          sizeBytes: 0,
          isDirectory: true,
          warning: "Temporary folders remain references and may disappear.",
          referenceStates: [],
        },
      ],
      homeEnvironmentId: mac,
      labelOf: label,
    });
    expect(views[0]).toMatchObject({
      kind: "image",
      name: "shot.png",
      detail: "Stored copy on Mac",
      sizeBytes: 2048,
      image: { attachmentId: "shot", mimeType: "image/png" },
    });
    expect(views[1]).toMatchObject({
      kind: "folder",
      name: "src",
      sizeBytes: null,
      missing: false,
      machines: [{ label: "Alpha", state: "missing" }],
    });
    expect(views[2]).toMatchObject({
      missing: true,
      warning: "Temporary folders remain references and may disappear.",
    });
  });
});

describe("taskStartTargets", () => {
  const label = (environmentId: EnvironmentId) => (environmentId === mac ? "Mac" : environmentId);
  const orbit = (connected: EnvironmentId[], list = projects) =>
    buildTaskProjectGroups({
      projects: list,
      settings,
      primaryEnvironmentId: mac,
      connected: new Set(connected),
    }).find((group) => group.label === "orbit")!;
  it("lists the task's machine first and explains every machine it cannot start on", () => {
    const group = orbit([mac, vpsA]);
    const entry = group.tasks.find((item) => item.task.id === "m1")!;
    expect(
      taskStartTargets(group, entry, label).map((target) => [
        target.project.environmentId,
        target.disabledReason,
      ]),
    ).toEqual([
      [mac, null],
      [vpsA, null],
      [vpsB, "Not connected"],
    ]);
    const withCopy = { ...entry, task: { ...entry.task, attachments: [storedImage("s", 1)] } };
    expect(taskStartTargets(group, withCopy, label)[1]?.disabledReason).toBe(
      "Has attachments stored on Mac",
    );
    // References travel as paths, so they never block another machine.
    const withPath = { ...entry, task: { ...entry.task, attachments: [reference("/r")] } };
    expect(taskStartTargets(group, withPath, label)[1]?.disabledReason).toBeNull();
  });
});

describe("taskThreadRefs", () => {
  it("resolves each link on the machine that ran it and keeps older links once", () => {
    const refs = taskThreadRefs(
      {
        latestThreadId: ThreadId.make("t3"),
        latestThreadEnvironmentId: vpsA,
        threadLinks: [
          { threadId: ThreadId.make("t3"), environmentId: vpsA },
          { threadId: ThreadId.make("t2") },
          { threadId: ThreadId.make("t1"), environmentId: vpsB },
        ],
      },
      mac,
    );
    expect(refs.latest).toEqual({ environmentId: vpsA, threadId: "t3" });
    expect(refs.previous).toEqual([
      { environmentId: mac, threadId: "t2" },
      { environmentId: vpsB, threadId: "t1" },
    ]);
    expect(taskThreadRefs({ latestThreadId: ThreadId.make("t1") }, mac).latest).toEqual({
      environmentId: mac,
      threadId: "t1",
    });
  });

  it("drops a pending link once the task records that thread", () => {
    const receipt = { thread: { environmentId: vpsA, threadId: ThreadId.make("t9") } };
    expect(pendingTaskLink(receipt, {}, mac)).toBe(receipt);
    expect(
      pendingTaskLink(
        receipt,
        { latestThreadId: ThreadId.make("t9"), latestThreadEnvironmentId: vpsA },
        mac,
      ),
    ).toBeNull();
    expect(pendingTaskLink(receipt, { latestThreadId: ThreadId.make("t9") }, mac)).toBe(receipt);
    expect(pendingTaskLink(undefined, {}, mac)).toBeNull();
  });
});
