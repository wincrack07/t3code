import type { EnvironmentConnectionSummary } from "@t3tools/client-runtime/state/presentation";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { buildActivityBoard, presentHostCapacity } from "./activityBoard.logic";

const vps = EnvironmentId.make("vps");
const mac = EnvironmentId.make("mac");

function environment(
  environmentId: EnvironmentId,
  overrides: Partial<EnvironmentConnectionSummary> = {},
): EnvironmentConnectionSummary {
  return {
    environmentId,
    environmentLabel: environmentId,
    displayUrl: "",
    isRelayManaged: false,
    isEnabled: true,
    connectionState: "connected",
    connectionError: null,
    connectionErrorTraceId: null,
    ...overrides,
  };
}

function project(environmentId: EnvironmentId, id: string, title: string): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title,
    workspaceRoot: `/work/${id}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-11-10T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
  };
}

const runtime = (status: "running" | "idle" | "failed", activityStartedAt: string | null = null) =>
  ({
    status,
    activeRunId: status === "running" ? RunId.make("run-1") : null,
    activityStartedAt,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: null,
    lastErrorClass: null,
    lastErrorCode: null,
    usageLimitResetAt: null,
    updatedAt: "2026-11-10T10:00:00.000Z",
  }) as const;

describe("buildActivityBoard", () => {
  it("groups active threads per environment and project, nesting subagents", () => {
    const parentId = ThreadId.make("parent");
    const threads = [
      makeThreadFixture({
        id: parentId,
        environmentId: vps,
        projectId: ProjectId.make("api"),
        title: "Refactor auth",
        runtime: runtime("running", "2026-11-10T10:00:00.000Z"),
        pendingBackgroundTasks: [
          { taskId: "task-1", kind: "subagent", childThreadId: ThreadId.make("child") },
        ],
      }),
      // Provider subagents have no runs; the parent's roster keeps them on the board.
      makeThreadFixture({
        id: ThreadId.make("child"),
        environmentId: vps,
        projectId: ProjectId.make("api"),
        title: "Explore tests",
        lineage: {
          rootThreadId: parentId,
          parentThreadId: parentId,
          relationshipToParent: "subagent",
        },
      }),
      makeThreadFixture({
        id: ThreadId.make("finished-child"),
        environmentId: vps,
        projectId: ProjectId.make("api"),
        lineage: {
          rootThreadId: parentId,
          parentThreadId: parentId,
          relationshipToParent: "subagent",
        },
      }),
      makeThreadFixture({
        id: ThreadId.make("question"),
        environmentId: vps,
        projectId: ProjectId.make("web"),
        title: "Pick a palette",
        hasPendingUserInput: true,
        pendingUserInputAt: "2026-11-10T10:05:00.000Z",
      }),
      makeThreadFixture({
        id: ThreadId.make("dev-server"),
        environmentId: vps,
        projectId: ProjectId.make("web"),
        title: "Serve docs",
        runtime: runtime("failed"),
        pendingBackgroundTasks: [{ taskId: "task-2", kind: "command", description: "vp run dev" }],
      }),
      makeThreadFixture({ id: ThreadId.make("at-rest"), environmentId: vps }),
      makeThreadFixture({
        id: ThreadId.make("archived"),
        environmentId: vps,
        runtime: runtime("running"),
        archivedAt: "2026-11-10T09:00:00.000Z",
      }),
      makeThreadFixture({
        id: ThreadId.make("stale"),
        environmentId: mac,
        runtime: runtime("running"),
      }),
    ];

    const [vpsColumn, macColumn, ...rest] = buildActivityBoard({
      environments: [
        environment(vps),
        environment(mac, { connectionState: "reconnecting" }),
        environment(EnvironmentId.make("off"), { isEnabled: false }),
      ],
      threads,
      projects: [project(vps, "api", "API"), project(vps, "web", "Web")],
    });

    expect(rest).toEqual([]);
    expect(
      vpsColumn?.groups.map((group) => ({
        project: group.project?.title,
        cards: group.cards.map((card) => ({
          id: card.thread.id,
          state: card.state,
          label: card.label,
          since: card.since,
          subagents: card.subagents.map((child) => [child.thread.id, child.label]),
        })),
      })),
    ).toEqual([
      {
        project: "Web",
        cards: [
          {
            id: "question",
            state: "input",
            label: "Waiting for your answer",
            since: "2026-11-10T10:05:00.000Z",
            subagents: [],
          },
          {
            id: "dev-server",
            state: "background",
            label: "Running · vp run dev",
            since: null,
            subagents: [],
          },
        ],
      },
      {
        project: "API",
        cards: [
          {
            id: "parent",
            state: "working",
            label: "Working",
            since: "2026-11-10T10:00:00.000Z",
            subagents: [["child", "Working"]],
          },
        ],
      },
    ]);
    expect(vpsColumn?.cardCount).toBe(3);
    expect(macColumn).toMatchObject({ connected: false, cardCount: 0, groups: [] });
  });
});

describe("presentHostCapacity", () => {
  const GB = 1024 ** 3;
  it.each([
    { cpu: 0.2, available: 12 * GB, level: "ok" },
    { cpu: 0.8, available: 12 * GB, level: "busy" },
    { cpu: 0.2, available: 2 * GB, level: "busy" },
    { cpu: 0.97, available: 12 * GB, level: "strained" },
    { cpu: null, available: 0.5 * GB, level: "strained" },
  ] as const)("reads cpu $cpu with $available bytes free as $level", (row) => {
    expect(
      presentHostCapacity({
        sampledAt: 0,
        cpuUtilization: row.cpu,
        cpuCount: 8,
        availableMemoryBytes: row.available,
        totalMemoryBytes: 16 * GB,
      })?.level,
    ).toBe(row.level);
  });
});
