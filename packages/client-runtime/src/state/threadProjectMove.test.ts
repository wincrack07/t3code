import { CheckpointScopeId, ProjectId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  previousProjectCheckpoints,
  threadProjectMoveRejection,
  threadProjectMoveUndo,
} from "./threadProjectMove.ts";

const app = ProjectId.make("app");
const docs = ProjectId.make("docs");
const move = (
  previousProjectId: ProjectId,
  projectId: ProjectId,
  previousCwd: string,
  cwd: string,
) => ({
  previousProjectId,
  projectId,
  previousCwd,
  cwd,
  movedAt: "2026-11-12T00:00:00.000Z",
});
const scope = (id: string, cwd: string, projectId?: ProjectId) => ({
  id: CheckpointScopeId.make(id),
  cwd,
  ...(projectId === undefined ? {} : { projectId }),
});
const checkpoint = (scopeId: string, run: number | null, ordinalWithinScope = run ?? 0) => ({
  scopeId: CheckpointScopeId.make(scopeId),
  runId: run === null ? null : RunId.make(`run-${run}`),
  appRunOrdinal: run,
  ordinalWithinScope,
  status: "ready" as const,
});

describe("previousProjectCheckpoints", () => {
  it("marks turns captured in another project's folder until the thread moves back", () => {
    const scopes = [scope("before", "/app", app), scope("after", "/docs", docs)];
    const checkpoints = [
      checkpoint("before", null),
      checkpoint("before", 1),
      checkpoint("after", 2, 0),
    ];
    const moved = previousProjectCheckpoints({
      thread: {
        projectId: docs,
        worktreePath: null,
        projectMoves: [move(app, docs, "/app", "/docs")],
      },
      checkpointScopes: scopes,
      checkpoints,
    });
    expect([...moved.byTurnCount]).toEqual([
      [0, app],
      [1, app],
    ]);
    expect([...moved.byRunId]).toEqual([[RunId.make("run-1"), app]]);

    const movedBack = previousProjectCheckpoints({
      thread: {
        projectId: app,
        worktreePath: null,
        projectMoves: [move(app, docs, "/app", "/docs"), move(docs, app, "/docs", "/app")],
      },
      checkpointScopes: scopes,
      checkpoints,
    });
    expect([...movedBack.byTurnCount]).toEqual([[2, docs]]);
  });

  it("falls back to the folder for scopes without an owner and ignores threads never moved", () => {
    const scopes = [scope("worktree", "/wt/feature")];
    const checkpoints = [checkpoint("worktree", 1)];
    expect(
      previousProjectCheckpoints({
        thread: {
          projectId: docs,
          worktreePath: null,
          projectMoves: [move(app, docs, "/wt/feature", "/docs")],
        },
        checkpointScopes: scopes,
        checkpoints,
      }).byTurnCount.get(1),
    ).toBe(app);
    expect(
      previousProjectCheckpoints({
        thread: { projectId: app, worktreePath: "/wt/feature" },
        checkpointScopes: scopes,
        checkpoints,
      }).byTurnCount.size,
    ).toBe(0);
  });
});

describe("threadProjectMoveUndo", () => {
  it("targets the previous project and says when the thread left a worktree", () => {
    expect(
      threadProjectMoveUndo({ projectMoves: [move(app, docs, "/wt/feature", "/docs")] }, "/app"),
    ).toEqual({ projectId: app, leftWorktree: true });
    expect(
      threadProjectMoveUndo({ projectMoves: [move(app, docs, "/app", "/docs")] }, "/app"),
    ).toEqual({ projectId: app, leftWorktree: false });
    expect(threadProjectMoveUndo({}, "/app")).toBeNull();
  });
});

describe("threadProjectMoveRejection", () => {
  it("reads the typed rejection from a dispatch error", () => {
    expect(
      threadProjectMoveRejection({ moveRejection: { reason: "detach_required", dirty: true } }),
    ).toEqual({ reason: "detach_required", dirty: true });
    expect(threadProjectMoveRejection(new Error("offline"))).toBeNull();
  });
});
