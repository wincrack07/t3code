import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  RunId,
  MessageId,
  type ProjectSavedPrompt,
  type ProjectScript,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import {
  planProjectCommand,
  type ProjectCommand,
  type ProjectCommandState,
} from "./ProjectCommands.ts";
import type { ProjectRow } from "./ProjectStore.ts";

const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const projectId = ProjectId.make("project-scripts");

const row = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  projectId,
  title: "Scripts",
  workspaceRoot: "/tmp/scripts",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const script = (id: string): ProjectScript => ({
  id,
  name: "Install dependencies",
  command: "vp i",
  icon: "configure",
  runOnWorktreeCreate: false,
});

const plan = (command: ProjectCommand, state: Partial<ProjectCommandState> = {}) =>
  planProjectCommand({
    command,
    state: { project: undefined, workspaceOwner: undefined, ...state },
    eventId: EventId.make("event:planned"),
    now,
  });

const payloadOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isSuccess(result));
  return Result.getOrThrow(result).payload as Record<string, unknown>;
};

const failureOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isFailure(result));
  return Result.isFailure(result) ? result.failure : assert.fail("expected a rejection");
};

describe("planProjectCommand", () => {
  it("enforces task limits and replaces the latest thread without completing the task", () => {
    const task: ProjectSavedPrompt = {
      id: "one",
      text: "Body",
      title: "Title",
      status: "done",
      createdAt: DateTime.formatIso(now),
      completedAt: DateTime.formatIso(now),
    };
    const update = (
      savedPrompt: NonNullable<
        Extract<ProjectCommand, { type: "project.meta.update" }>["savedPrompt"]
      >,
      items = [task],
    ) =>
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("task:update"),
          projectId,
          savedPrompt,
        },
        { project: row({ savedPrompts: items }) },
      );
    for (const savedPrompt of [
      { kind: "add", id: "two", text: "x".repeat(120001) },
      { kind: "edit", id: "one", text: "x".repeat(120001) },
      { kind: "edit", id: "one", title: "x".repeat(161) },
      { kind: "edit", id: "missing", status: "open" },
    ] as const)
      assert.strictEqual(failureOf(update(savedPrompt))._tag, "ProjectCommandInvariantError");
    assert.strictEqual(
      failureOf(
        update(
          { kind: "add", id: "new", text: "More" },
          Array.from({ length: 100 }, (_, i) => ({ ...task, id: String(i) })),
        ),
      )._tag,
      "ProjectCommandInvariantError",
    );
    assert.strictEqual(
      failureOf(
        update({ kind: "add", id: "new", text: "x".repeat(100001) }, [
          { ...task, text: "x".repeat(100000) },
        ]),
      )._tag,
      "ProjectCommandInvariantError",
    );
    const inbox = payloadOf(
      update({
        kind: "edit",
        id: "one",
        priority: "p1",
        when: "today",
        tags: ["Bug", "bug", "API"],
      }),
    ).savedPrompts as ProjectSavedPrompt[];
    assert.deepStrictEqual(inbox[0]?.tags, ["bug", "api"]);
    assert.strictEqual(inbox[0]?.priority, "p1");
    assert.strictEqual(inbox[0]?.when, "today");
    assert.strictEqual(
      failureOf(update({ kind: "edit", id: "one", tags: ["x".repeat(33)] }))._tag,
      "ProjectCommandInvariantError",
    );
    const reordered = payloadOf(
      update({ kind: "reorder", ids: ["two", "one"] }, [
        task,
        { ...task, id: "middle" },
        { ...task, id: "two" },
      ]),
    ).savedPrompts as ProjectSavedPrompt[];
    assert.deepStrictEqual(
      reordered.map((item) => item.id),
      ["two", "middle", "one"],
    );
    assert.strictEqual(
      failureOf(update({ kind: "reorder", ids: ["one", "one"] }))._tag,
      "ProjectCommandInvariantError",
    );
    const max = payloadOf(
      update({
        kind: "edit",
        id: "one",
        text: "x".repeat(120000),
        title: "x".repeat(160),
        status: "open",
      }),
    );
    assert.strictEqual((max.savedPrompts as ProjectSavedPrompt[])[0]?.completedAt, null);
    const linked = payloadOf(
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("task:link"),
          projectId,
          savedPromptThread: { id: "one", threadId: ThreadId.make("new-thread") },
        },
        {
          project: row({
            savedPrompts: [{ ...task, latestThreadId: ThreadId.make("old-thread") }],
          }),
        },
      ),
    );
    assert.deepStrictEqual(linked.savedPrompts, [
      {
        ...task,
        status: "in-progress",
        completedAt: null,
        latestThreadId: "new-thread",
        latestThreadEnvironmentId: undefined,
        threadLinks: [{ threadId: "new-thread" }, { threadId: "old-thread" }],
      },
    ]);
    const snapshot = {
      runId: RunId.make("attempt"),
      userMessageId: MessageId.make("message"),
      outcome: "completed" as const,
      finishedAt: DateTime.formatIso(now),
      pullRequests: [],
    };
    const running: ProjectSavedPrompt = {
      ...task,
      status: "in-progress",
      completedAt: null,
      latestThreadId: ThreadId.make("new-thread"),
      latestUserMessageId: snapshot.userMessageId,
      threadLinks: [{ threadId: ThreadId.make("new-thread") }],
    };
    const reviewed = payloadOf(
      update({ kind: "review", id: "one", threadId: running.latestThreadId!, snapshot }, [running]),
    ).savedPrompts as ProjectSavedPrompt[];
    assert.strictEqual(reviewed[0]?.status, "review");
    assert.strictEqual(reviewed[0]?.completedAt, null);
    assert.deepStrictEqual(reviewed[0]?.threadLinks?.[0]?.snapshot, snapshot);
    const approved = payloadOf(update({ kind: "approve", id: "one" }, reviewed))
      .savedPrompts as ProjectSavedPrompt[];
    assert.strictEqual(approved[0]?.status, "done");
    assert.deepStrictEqual(
      payloadOf(
        update(
          { kind: "review", id: "one", threadId: running.latestThreadId!, snapshot },
          approved,
        ),
      ).savedPrompts,
      approved,
    );
    const changed = payloadOf(
      update(
        {
          kind: "request-changes",
          id: "one",
          threadId: running.latestThreadId!,
          userMessageId: MessageId.make("followup"),
        },
        reviewed,
      ),
    ).savedPrompts as ProjectSavedPrompt[];
    assert.strictEqual(changed[0]?.status, "in-progress");
    assert.deepStrictEqual(
      payloadOf(
        update({ kind: "review", id: "one", threadId: running.latestThreadId!, snapshot }, changed),
      ).savedPrompts,
      changed,
    );
    assert.deepStrictEqual(
      payloadOf(
        update({ kind: "review", id: "one", threadId: ThreadId.make("old-thread"), snapshot }, [
          running,
        ]),
      ).savedPrompts,
      [running],
    );
    assert.strictEqual(
      failureOf(update({ kind: "approve", id: "one" }, [running]))._tag,
      "ProjectCommandInvariantError",
    );
    const history = payloadOf(
      update({ kind: "link", id: "one", threadId: ThreadId.make("new-thread") }, [
        {
          ...task,
          threadLinks: Array.from({ length: 10 }, (_, index) => ({
            threadId: ThreadId.make(`previous-${index}`),
          })),
        },
      ]),
    );
    assert.strictEqual((history.savedPrompts as ProjectSavedPrompt[])[0]?.threadLinks?.length, 10);
    assert.strictEqual(
      (history.savedPrompts as ProjectSavedPrompt[])[0]?.threadLinks?.at(-1)?.threadId,
      "previous-8",
    );
    assert.strictEqual(
      failureOf(
        plan(
          {
            type: "project.meta.update",
            commandId: CommandId.make("task:wrong-project"),
            projectId,
            savedPromptThread: { id: "one", threadId: ThreadId.make("new-thread") },
          },
          { project: row({ savedPrompts: [] }) },
        ),
      )._tag,
      "ProjectCommandInvariantError",
    );
  });

  it("keeps legacy scripts editable and removable while rejecting new invalid ones", () => {
    const legacy = script("install-javascript-dependencies");
    const withLegacy = (scripts: ReadonlyArray<ProjectScript>) =>
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-repair-script"),
          projectId,
          scripts,
        },
        { project: row({ scripts: [legacy] }) },
      );
    for (const scripts of [[{ ...legacy, command: "vp install" }, script("lint")], []]) {
      assert.deepEqual(payloadOf(withLegacy(scripts)).scripts, scripts);
    }
    assert.equal(
      failureOf(withLegacy([legacy, script("another.invalid.id")]))._tag,
      "ProjectCommandInvariantError",
    );
  });

  it("keeps the first pin and archive time, and clears both on undo", () => {
    const earlier = "2025-12-01T00:00:00.000Z";
    const update = (project: ProjectRow, change: { pinned?: boolean; archived?: boolean }) =>
      payloadOf(
        plan(
          {
            type: "project.meta.update",
            commandId: CommandId.make("cmd-organize"),
            projectId,
            ...change,
          },
          { project },
        ),
      );
    assert.deepInclude(update(row(), { pinned: true, archived: true }), {
      pinnedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const organized = row({ pinnedAt: earlier, archivedAt: earlier });
    assert.deepInclude(update(organized, { pinned: true, archived: true }), {
      pinnedAt: earlier,
      archivedAt: earlier,
    });
    assert.deepInclude(update(organized, { pinned: false, archived: false }), {
      pinnedAt: null,
      archivedAt: null,
    });
    const untouched = update(organized, {});
    assert.notProperty(untouched, "pinnedAt");
    assert.notProperty(untouched, "archivedAt");
  });

  it("rejects a workspace root held by another active project", () => {
    const owner = row({
      projectId: ProjectId.make("project-existing"),
      workspaceRoot: "/tmp/project",
    });
    const create = failureOf(
      plan(
        {
          type: "project.create",
          commandId: CommandId.make("cmd-duplicate-root"),
          projectId: ProjectId.make("project-duplicate-root"),
          title: "Duplicate",
          workspaceRoot: "/tmp/project",
        },
        { workspaceOwner: owner },
      ),
    );
    assert.equal(create._tag, "ProjectWorkspaceConflictError");
    assert.equal(
      create.message,
      "Active project 'project-existing' already exists for workspace root '/tmp/project'.",
    );
    const move = failureOf(
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-move-root"),
          projectId,
          workspaceRoot: "/tmp/project",
        },
        { project: row(), workspaceOwner: owner },
      ),
    );
    assert.equal(move._tag, "ProjectWorkspaceConflictError");
  });

  it("requires the project to exist, and to be absent on create", () => {
    const create: ProjectCommand = {
      type: "project.create",
      commandId: CommandId.make("cmd-create-twice"),
      projectId,
      title: "Twice",
      workspaceRoot: "/tmp/twice",
    };
    assert.include(failureOf(plan(create, { project: row() })).message, "cannot be created twice");
    const deleted = row({ deletedAt: "2026-01-01T00:00:00.000Z" });
    assert.include(
      failureOf(plan(create, { project: deleted })).message,
      "cannot be created twice",
    );
    for (const command of [
      { type: "project.meta.update", commandId: CommandId.make("cmd-missing"), projectId },
      { type: "project.delete", commandId: CommandId.make("cmd-missing"), projectId },
    ] as const) {
      for (const project of [undefined, deleted]) {
        assert.equal(
          failureOf(plan(command, { project }))._tag,
          "ProjectCommandMissingProjectError",
        );
      }
    }
  });
});
