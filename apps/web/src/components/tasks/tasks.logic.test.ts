import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  ProviderInstanceId,
  type RuntimeMode,
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
  NO_TASK_FILTER,
  normalizeTaskTags,
  taskCaptureProjectKey,
  taskRunningMinutes,
  nextTaskSelection,
  taskBatchSummary,
  taskQueueTotals,
  taskQueueView,
  taskQueueItems,
  taskRunProject,
  editTaskCriteria,
  taskAttempts,
  taskSubtaskCounts,
  taskSubtasks,
  taskReviewToReconcile,
  taskReviewView,
  reviewTaskCount,
  taskDropPlan,
  type TaskFilter,
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
  const filter = (extra: Partial<TaskFilter>): TaskFilter => ({ ...NO_TASK_FILTER, ...extra });
  const ids = (rows: ReadonlyArray<{ entry: { task: { id: string } }; depth: number }>) =>
    rows.map((row) => `${"  ".repeat(row.depth)}${row.entry.task.id}`);

  it("splits open and done sections and counts unreachable machines once", () => {
    const list = buildTaskList(groups, NO_TASK_FILTER);
    expect(list.sections.map((section) => [section.label, section.rows.length])).toEqual([
      ["lumen", 1],
      ["orbit", 2],
    ]);
    expect(ids(list.done)).toEqual(["a2"]);
    expect([list.openCount, list.doneCount, list.unreachable, list.empty]).toEqual([3, 1, 1, null]);
    expect(taskListOrder(list, false)).toHaveLength(3);
    expect(taskListOrder(list, true)).toHaveLength(4);
  });

  it("filters to one logical project and explains an empty result", () => {
    const lumen = groups.find((group) => group.label === "lumen")!;
    expect(buildTaskList(groups, filter({ projectKey: lumen.key })).openCount).toBe(1);
    expect(buildTaskList(groups, filter({ projectKey: lumen.key })).unreachable).toBe(0);
    expect(buildTaskList(groups, filter({ projectKey: "missing" })).empty).toBe("filtered");
    expect(buildTaskList(groups, filter({ query: "nothing matches" })).empty).toBe("filtered");
    expect(buildTaskList([], NO_TASK_FILTER).empty).toBe("none");
  });

  const inboxGroups = buildTaskProjectGroups({
    projects: [
      project(mac, "orbit", [
        task("t1", "2026-11-09T00:00:00Z", { when: "today", priority: "p1", tags: ["ui"] }),
        task("c1", "2026-11-08T00:00:00Z", { parentTaskId: "t1", when: "later" }),
        task("l1", "2026-11-07T00:00:00Z", { when: "later", tags: ["api"] }),
        task("n1", "2026-11-06T00:00:00Z", { title: "Fix login" }),
        task("t2", "2026-11-05T00:00:00Z", { when: "today" }),
        task("d1", "2026-11-04T00:00:00Z", { status: "done", completedAt: "2026-11-10T00:00:00Z" }),
      ]),
      project(vpsA, "orbit", [task("v1", "2026-11-10T00:00:00Z", { when: "today" })]),
      project(mac, "lumen", [task("x1", "2026-11-06T12:00:00Z")]),
    ],
    settings,
    primaryEnvironmentId: mac,
    connected: new Set([mac, vpsA]),
  });

  it("groups the inbox by when in manual order, with subtasks under their parent", () => {
    const inbox = buildTaskList(inboxGroups, NO_TASK_FILTER, "inbox");
    expect(inbox.sections.map((section) => [section.id, ids(section.rows)])).toEqual([
      ["today", ["v1", "t1", "  c1", "t2"]],
      ["later", ["l1"]],
      // Projects interleave by their newer head, so lumen's x1 sits between orbit's tasks.
      ["none", ["x1", "n1"]],
    ]);
    expect(ids(inbox.done)).toEqual(["d1"]);
    expect([inbox.openCount, inbox.doneCount]).toEqual([7, 1]);
  });

  it("filters by priority, tag, machine and words, and lifts a subtask whose parent is hidden", () => {
    const rows = (extra: Partial<TaskFilter>) =>
      buildTaskList(inboxGroups, filter(extra), "inbox").sections.flatMap((section) =>
        ids(section.rows),
      );
    expect(rows({ priority: "p1" })).toEqual(["t1"]);
    expect(rows({ priority: "p3" })).toEqual(["v1", "t2", "c1", "l1", "x1", "n1"]);
    expect(rows({ tag: "api" })).toEqual(["l1"]);
    expect(rows({ environmentId: vpsA })).toEqual(["v1"]);
    expect(rows({ query: "fix LOGIN" })).toEqual(["n1"]);
    expect(rows({ query: "orbit api" })).toEqual(["l1"]);
  });

  it("plans reorders within one machine's siblings and section moves that set when", () => {
    const inbox = buildTaskList(inboxGroups, NO_TASK_FILTER, "inbox");
    const key = (environmentId: EnvironmentId, id: string) =>
      `${environmentId}:orbit-${environmentId}:${id}`;
    // t2 above t1: only mac's top-level today tasks are permuted; vps-a's v1 is left alone.
    expect(
      taskDropPlan(inbox, key(mac, "t2"), { sectionId: "today", overKey: key(mac, "t1") }),
    ).toMatchObject({ when: null, reorder: ["t2", "t1"] });
    // A drop beside another machine's task changes nothing.
    expect(
      taskDropPlan(inbox, key(mac, "t2"), { sectionId: "today", overKey: key(vpsA, "v1") }),
    ).toBeNull();
    // Into Later above l1: sets when and places it first.
    expect(
      taskDropPlan(inbox, key(mac, "n1"), { sectionId: "later", overKey: key(mac, "l1") }),
    ).toMatchObject({ when: "later", reorder: ["n1", "l1"] });
    // Onto an empty section header: only when.
    expect(taskDropPlan(inbox, key(mac, "l1"), { sectionId: "none", overKey: null })).toMatchObject(
      { when: "none", reorder: null },
    );
    // A subtask follows its parent, so it never changes section on its own.
    expect(
      taskDropPlan(inbox, key(mac, "c1"), { sectionId: "later", overKey: key(mac, "l1") }),
    ).toBeNull();
  });
});

describe("taskCaptureProjectKey", () => {
  it("takes the first preference that can store tasks, else the first project", () => {
    const storable = [{ key: "a" }, { key: "b" }];
    expect(taskCaptureProjectKey(storable, [null, "b", "a"])).toBe("b");
    expect(taskCaptureProjectKey(storable, ["gone", null])).toBe("a");
    expect(taskCaptureProjectKey([], ["a"])).toBeNull();
  });
});

describe("normalizeTaskTags", () => {
  it("trims, lowercases, deduplicates and caps tags like the server", () => {
    expect(normalizeTaskTags([" UI ", "ui", "", "Api"])).toEqual(["ui", "api"]);
    expect(normalizeTaskTags(["x".repeat(40)])).toEqual(["x".repeat(32)]);
    expect(normalizeTaskTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(12);
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
    const board = buildTaskBoard(groups, NO_TASK_FILTER);
    const ids = (rows: ReadonlyArray<{ entry: { task: { id: string } } }>) =>
      rows.map((row) => row.entry.task.id);
    expect(ids(board.open)).toEqual(["b1", "a1", "m1"]);
    expect(ids(board["in-progress"])).toEqual(["l1"]);
    expect(ids(board.done)).toEqual(["a2"]);
    const orbitKey = groups.find((group) => group.label === "orbit")!.key;
    expect(
      buildTaskBoard(groups, { ...NO_TASK_FILTER, projectKey: orbitKey })["in-progress"],
    ).toEqual([]);
  });

  it("changes status only for a drop on a different column", () => {
    expect(taskStatusForDrop({ status: "open" }, "done")).toBe("done");
    expect(taskStatusForDrop({ status: "open" }, "open")).toBeNull();
    // Review fills only from a settled thread; a review card on Done is an approval.
    expect(taskStatusForDrop({ status: "in-progress" }, "review")).toBeNull();
    expect(taskStatusForDrop({ status: "review" }, "done")).toBe("approve");
    expect(taskStatusForDrop({ status: "review" }, "open")).toBe("open");
    expect(taskStatusForDrop({ status: "open" }, "task:abc")).toBeNull();
    expect(taskStatusForDrop({ status: "open" }, null)).toBeNull();
  });
});

describe("review", () => {
  const snapshot = {
    runId: "run-1",
    userMessageId: "msg-1",
    outcome: "completed",
    finishedAt: "2026-11-12T10:04:00.000Z",
    durationMs: 245_000,
    assistantMessage:
      "## Done\n\nAdded **pagination** to `GET /events`.\n\n```ts\nconst x = 1;\n```\n- see [docs](https://x.dev)",
    changes: { count: 3, additions: 84, deletions: 12 },
    pullRequests: [{ number: 42, url: "https://github.com/acme/orbit/pull/42", state: "open" }],
  } as unknown as NonNullable<ProjectSavedPrompt["review"]>;

  it("presents the outcome, a plain excerpt, change stats and duration", () => {
    expect(taskReviewView(snapshot)).toMatchObject({
      outcome: "Finished",
      tone: "success",
      excerpt: "Done Added pagination to GET /events. see docs",
      changes: { files: 3, label: "+84 \u221212" },
      duration: "4 min",
    });
    expect(
      taskReviewView({
        ...snapshot,
        outcome: "waiting for input",
        assistantMessage: undefined,
        changes: undefined,
        durationMs: undefined,
      } as typeof snapshot),
    ).toMatchObject({
      outcome: "Finished with questions",
      tone: "warning",
      excerpt: null,
      changes: null,
      duration: null,
    });
    expect(taskReviewView({ ...snapshot, outcome: "failed" }).tone).toBe("error");
    expect(taskReviewView({ ...snapshot, durationMs: 3_900_000 }).duration).toBe("1 h 5 min");
  });

  it("reconciles only a settled thread that ran on another machine", () => {
    const home = project(mac, "orbit", []);
    const entry = (
      extra: Partial<ProjectSavedPrompt>,
      status: "in-progress" | "review" = "in-progress",
    ) => ({
      home,
      status,
      task: task("r1", "2026-11-01T00:00:00Z", { latestThreadId: ThreadId.make("t9"), ...extra }),
    });
    expect(taskReviewToReconcile(entry({ latestThreadEnvironmentId: vpsA }), "finished")).toEqual({
      environmentId: vpsA,
      threadId: "t9",
    });
    expect(taskReviewToReconcile(entry({ latestThreadEnvironmentId: vpsA }), "running")).toBeNull();
    expect(taskReviewToReconcile(entry({ latestThreadEnvironmentId: mac }), "finished")).toBeNull();
    expect(taskReviewToReconcile(entry({}), "finished")).toBeNull();
    expect(
      taskReviewToReconcile(entry({ latestThreadEnvironmentId: vpsA }, "review"), "finished"),
    ).toBeNull();
  });

  it("counts review tasks as needing attention", () => {
    expect(
      reviewTaskCount({
        tasks: [{ status: "review" }, { status: "open" }, { status: "review" }] as never,
      }),
    ).toBe(2);
  });
});

describe("taskRunningMinutes", () => {
  it("counts whole minutes once the first one has passed", () => {
    const start = "2026-11-12T10:00:00.000Z";
    expect(taskRunningMinutes(start, "2026-11-12T10:00:40Z")).toBeNull();
    expect(taskRunningMinutes(start, "2026-11-12T10:04:10Z")).toBe(4);
    expect(taskRunningMinutes(null, "2026-11-12T10:04:10Z")).toBeNull();
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

describe("editTaskCriteria", () => {
  const list = [
    { text: "Tests pass", done: false },
    { text: "Docs updated", done: true },
  ];
  it("adds, edits, toggles, moves and removes within the limits", () => {
    expect(editTaskCriteria(list, { kind: "add", text: "  No  regressions " })?.at(-1)).toEqual({
      text: "No regressions",
      done: false,
    });
    expect(editTaskCriteria(list, { kind: "add", text: "   " })).toBeNull();
    const full = Array.from({ length: 20 }, (_, i) => ({ text: `c${i}`, done: false }));
    expect(editTaskCriteria(full, { kind: "add", text: "one more" })).toBeNull();
    expect(
      editTaskCriteria(list, { kind: "add", text: "x".repeat(600) })?.at(-1)?.text,
    ).toHaveLength(500);
    expect(editTaskCriteria(list, { kind: "edit", index: 0, text: "Tests pass" })).toBeNull();
    expect(editTaskCriteria(list, { kind: "edit", index: 0, text: "" })).toEqual([list[1]]);
    expect(editTaskCriteria(list, { kind: "toggle", index: 0 })?.[0]?.done).toBe(true);
    expect(editTaskCriteria(list, { kind: "move", from: 1, to: 0 })?.map((c) => c.text)).toEqual([
      "Docs updated",
      "Tests pass",
    ]);
    expect(editTaskCriteria(list, { kind: "move", from: 0, to: -3 })).toBeNull();
    expect(editTaskCriteria(list, { kind: "remove", index: 5 })).toBeNull();
  });
});

describe("subtasks and attempts", () => {
  const groups = buildTaskProjectGroups({
    projects: [
      project(mac, "orbit", [
        task("p1", "2026-11-09T00:00:00Z"),
        task("c1", "2026-11-08T00:00:00Z", {
          parentTaskId: "p1",
          status: "done",
          completedAt: "2026-11-10T00:00:00Z",
        }),
        task("c2", "2026-11-07T00:00:00Z", { parentTaskId: "p1" }),
      ]),
      project(vpsA, "orbit", [task("c3", "2026-11-07T00:00:00Z", { parentTaskId: "p1" })]),
    ],
    settings,
    primaryEnvironmentId: mac,
    connected: new Set([mac, vpsA]),
  });
  const orbit = groups[0]!;

  it("runs on the saved machine when it is connected, else the task's own", () => {
    const parent = orbit.tasks.find((entry) => entry.task.id === "p1")!;
    const on = (targetEnvironmentId: EnvironmentId) =>
      taskRunProject(
        { ...parent, task: { ...parent.task, runSettings: { targetEnvironmentId } } },
        orbit,
      ).environmentId;
    expect(on(vpsA)).toBe(vpsA);
    expect(on(vpsB)).toBe(mac);
    expect(taskRunProject(parent, orbit).environmentId).toBe(mac);
  });

  it("counts only subtasks on the parent's own machine", () => {
    const parent = orbit.tasks.find((entry) => entry.task.id === "p1")!;
    const subtasks = taskSubtasks(orbit, parent);
    expect(subtasks.map((entry) => entry.task.id)).toEqual(["c1", "c2"]);
    expect(taskSubtaskCounts(subtasks)).toEqual({ total: 2, done: 1 });
  });

  it("lists attempts newest first with the machine and result of each", () => {
    const attempts = taskAttempts(
      {
        threadLinks: [
          { threadId: ThreadId.make("t1"), userMessageId: "m2" as never, environmentId: vpsA },
          {
            threadId: ThreadId.make("t1"),
            userMessageId: "m1" as never,
            environmentId: vpsA,
            snapshot: {
              runId: "r1",
              userMessageId: "m1",
              outcome: "failed",
              finishedAt: "2026-11-10T00:00:00.000Z",
              pullRequests: [],
            } as never,
          },
          { threadId: ThreadId.make("t0") },
        ],
      },
      mac,
    );
    expect(
      attempts.map((a) => [a.thread.environmentId, a.remote, a.review?.outcome ?? null]),
    ).toEqual([
      [vpsA, true, null],
      [vpsA, true, "Failed"],
      [mac, false, null],
    ]);
    expect(new Set(attempts.map((a) => a.key)).size).toBe(3);
  });
});

describe("batch", () => {
  it("toggles one task, or with Shift adds the range from the anchor in view order", () => {
    const order = ["a", "b", "c", "d"];
    expect([...nextTaskSelection(new Set(), order, "b", null, false)]).toEqual(["b"]);
    expect([...nextTaskSelection(new Set(["b"]), order, "b", "b", false)]).toEqual([]);
    expect([...nextTaskSelection(new Set(["a"]), order, "c", "a", true)].toSorted()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect([...nextTaskSelection(new Set(["d"]), order, "b", "d", true)].toSorted()).toEqual([
      "b",
      "c",
      "d",
    ]);
    // No anchor in this view: Shift falls back to a toggle.
    expect([...nextTaskSelection(new Set(), order, "c", "gone", true)]).toEqual(["c"]);
  });

  const stored = {
    kind: "stored",
    attachment: {
      type: "image",
      id: ChatAttachmentId.make("img-1"),
      name: "a.png",
      mimeType: "image/png",
      sizeBytes: 10,
    },
  } as unknown as ProjectTaskAttachment;
  const groups = buildTaskProjectGroups({
    projects: [
      project(mac, "orbit", [
        task("m1", "2026-11-09T00:00:00Z"),
        task("m2", "2026-11-08T00:00:00Z", { attachments: [stored] }),
      ]),
      project(vpsA, "orbit", []),
    ],
    settings,
    primaryEnvironmentId: mac,
    connected: new Set([mac, vpsA]),
  });
  const entries = groups[0]!.tasks;
  const labels: Record<string, string> = { mac: "Mac", "vps-a": "Alpha" };
  const label = (environmentId: EnvironmentId) => labels[environmentId] ?? environmentId;
  const model = (slug: string, effort?: string) => ({
    instanceId: ProviderInstanceId.make("claude"),
    model: slug,
    ...(effort ? { options: [{ id: "effort", value: effort }] } : {}),
  });
  const launch = (slug: string, effort?: string, runtimeMode: RuntimeMode = "full-access") => ({
    modelSelection: model(slug, effort),
    runtimeMode,
    threadEnvMode: "worktree" as const,
  });
  const plan = [
    {
      environmentId: vpsA,
      currentEffectiveConcurrency: 1,
      effectiveConcurrency: 2,
      input: {
        projectId: "orbit-vps-a",
        entries: [{ source: { environmentId: mac, taskId: "m1" }, launch: launch("opus", "high") }],
      },
      unresolved: [],
    },
    {
      environmentId: mac,
      currentEffectiveConcurrency: 2,
      effectiveConcurrency: 2,
      input: {
        projectId: "orbit-mac",
        entries: [
          {
            source: { environmentId: mac, taskId: "m2" },
            launch: { ...launch("opus"), threadEnvMode: undefined },
          },
        ],
      },
      unresolved: [],
    },
  ];
  const labelSet = { machine: label, model: (selection: { model: string }) => selection.model };

  it("lists what each task runs with by machine, and why one stays on its own machine", () => {
    const summary = taskBatchSummary(
      plan,
      entries,
      { distribute: true, environmentId: null },
      labelSet,
    );
    expect(summary.headline).toBe("2 tasks · opus · Full access · 2 machines");
    expect(summary.runnable).toBe(2);
    expect(summary.rows).toEqual([
      {
        environmentId: vpsA,
        machine: "Alpha",
        capChange: "Alpha runs 1 at a time; this batch changes it to 2.",
        tasks: [
          {
            key: entries[0]!.key,
            title: "Prompt m1",
            pinned: null,
            blocked: null,
            model: "opus",
            effort: "high",
            access: "Full access",
            workspace: "Worktree",
            modelDiffers: false,
            accessDiffers: false,
          },
        ],
      },
      {
        environmentId: mac,
        machine: "Mac",
        capChange: null,
        tasks: [
          {
            key: entries[1]!.key,
            title: "Prompt m2",
            pinned: "Stays on Mac because its attachments are stored there.",
            blocked: null,
            model: "opus",
            effort: "provider default",
            access: "Full access",
            workspace: "Local",
            modelDiffers: false,
            accessDiffers: false,
          },
        ],
      },
    ]);
    // Running everything on the task's own machine pins nothing.
    const home = taskBatchSummary(
      plan,
      entries,
      { distribute: false, environmentId: mac },
      labelSet,
    );
    expect(home.rows.flatMap((row) => row.tasks.map((t) => t.pinned))).toEqual([null, null]);
  });

  it("calls out mixed models and access, and counts only tasks that will run", () => {
    const mixed = [
      {
        ...plan[0]!,
        input: {
          ...plan[0]!.input,
          entries: [
            { source: { environmentId: mac, taskId: "m1" }, launch: launch("sonnet") },
            {
              source: { environmentId: mac, taskId: "m3" },
              launch: launch("opus", undefined, "approval-required"),
            },
          ],
        },
      },
      {
        ...plan[1]!,
        input: { ...plan[1]!.input, entries: [] },
        unresolved: [
          {
            source: { environmentId: mac, taskId: "m2" },
            launch: launch("t3:auto"),
            failureReason: "unresolved-model" as const,
          },
        ],
      },
    ];
    const withThird = [...entries, { ...entries[0]!, key: "m3", task: task("m3", "1") }];
    const summary = taskBatchSummary(
      mixed,
      withThird,
      { distribute: false, environmentId: null },
      labelSet,
    );
    expect(summary.headline).toBe(
      "3 tasks · 2 models · 2 access modes · 2 machines · 1 will not run",
    );
    expect(summary.runnable).toBe(2);
    const mac_ = summary.rows.find((row) => row.environmentId === mac)!;
    expect(mac_.tasks[0]).toMatchObject({
      model: "Auto",
      blocked: expect.stringContaining("Run with"),
    });
    // A machine with nothing to run does not change its cap.
    expect(mac_.capChange).toBeNull();
    expect(
      summary.rows
        .find((row) => row.environmentId === vpsA)!
        .tasks.map((t) => [t.modelDiffers, t.accessDiffers]),
    ).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it("shows a task's newest live queue entry, refusals while it waits, and sums every batch", () => {
    const target = { environmentId: mac, projectId: "orbit-mac" };
    const item = (state: string, createdAt: string, position: number | null = null) => ({
      target,
      batchId: `b-${createdAt}`,
      createdAt,
      cap: 2,
      entry: {
        id: `e-${createdAt}`,
        state,
        reason: state === "failed-to-start" ? "No model" : "Prepare the batch again.",
        ...(state === "cancelled" ? { failureReason: "task-changed" } : {}),
      } as never,
      position,
    });
    expect(taskQueueView([], "open")).toBeNull();
    expect(
      taskQueueView([item("failed-to-start", "1"), item("queued", "2", 3)], "open"),
    ).toMatchObject({ state: "queued", position: 3 });
    expect(taskQueueView([item("queued", "1", 1), item("settled", "2")], "open")).toBeNull();
    expect(taskQueueView([item("failed-to-start", "1")], "open")?.reason).toBe("No model");
    expect(taskQueueView([item("cancelled", "1")], "open")).toMatchObject({
      state: "refused",
      reason: "The task was edited after the batch was confirmed.",
    });
    // Cancelled by the person, or the task moved on: nothing to show.
    expect(
      taskQueueView(
        [{ ...item("cancelled", "1"), entry: { id: "e", state: "cancelled" } }],
        "open",
      ),
    ).toBeNull();
    expect(taskQueueView([item("cancelled", "1")], "in-progress")).toBeNull();

    const withBatches = {
      ...project(mac, "orbit", []),
      taskBatches: [
        {
          id: "b1",
          concurrency: 2,
          effectiveConcurrency: 3,
          createdAt: "1",
          entries: [{ state: "running" }, { state: "queued" }, { state: "queued" }],
        },
        {
          id: "b2",
          concurrency: 2,
          createdAt: "2",
          entries: [{ state: "failed-to-start" }, { state: "settled" }],
        },
      ],
    } as unknown as EnvironmentProject;
    const queuedTask = (id: string) => ({
      environmentId: mac,
      projectId: withBatches.id,
      taskId: id,
    });
    const queue = {
      ...withBatches,
      taskBatches: [
        {
          id: "b1",
          concurrency: 2,
          createdAt: "1",
          entries: [
            { id: "e1", state: "queued", source: queuedTask("x") },
            { id: "e2", state: "running", source: queuedTask("y") },
            { id: "e3", state: "queued", source: queuedTask("y") },
          ],
        },
      ],
    } as unknown as EnvironmentProject;
    const forTask = (id: string) =>
      taskQueueItems({ home: withBatches, task: { id } as ProjectSavedPrompt }, [queue]);
    expect(forTask("y").map((item) => [item.entry.state, item.position])).toEqual([
      ["running", null],
      ["queued", 2],
    ]);
    expect(taskQueueView(forTask("x"), "open")).toMatchObject({ position: 1, cap: 2 });
    expect(taskQueueTotals([withBatches], [])).toEqual({
      queued: 2,
      starting: 0,
      running: 1,
      failed: 1,
      cancellable: [{ environmentId: mac, projectId: withBatches.id, batchId: "b1" }],
      caps: [{ environmentId: mac, cap: 3 }],
      refused: [],
    });
    const refusedTask = { home: withBatches, task: task("z", "1"), status: "open" as const };
    const refusedBatch = {
      ...withBatches,
      taskBatches: [
        {
          id: "b3",
          concurrency: 2,
          createdAt: "3",
          entries: [
            {
              id: "e9",
              state: "cancelled",
              failureReason: "source-deleted",
              source: queuedTask("z"),
            },
          ],
        },
      ],
    } as unknown as EnvironmentProject;
    expect(
      taskQueueTotals([refusedBatch], [refusedTask as never]).refused.map((r) => r.queue.reason),
    ).toEqual(["The task was deleted before it started."]);
  });
});
