import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadMoveTargetSections,
  detachConfirmationMessage,
} from "./threadProjectMove.logic";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");

function group(key: string, members: ReadonlyArray<readonly [EnvironmentId, string]>) {
  const memberProjects = members.map(([environmentId, id]) => ({
    environmentId,
    id: ProjectId.make(id),
  }));
  return {
    projectKey: key,
    archived: false,
    memberProjects,
    memberProjectRefs: memberProjects.map(({ environmentId, id }) => ({
      environmentId,
      projectId: id,
    })),
  };
}

describe("buildThreadMoveTargetSections", () => {
  it("groups targets like the sidebar and explains the ones a thread cannot move to", () => {
    const sections = buildThreadMoveTargetSections({
      groups: [
        group("app", [
          [laptop, "app-laptop"],
          [server, "app-server"],
        ]),
        group("docs", [[laptop, "docs-laptop"]]),
        group("infra", [[server, "infra-server"]]),
        { ...group("scratch", [[server, "scratch"]]), isScratch: true },
        { ...group("old", [[server, "old"]]), archived: true },
      ],
      folders: [{ id: "work", name: "Work", emoji: "", projectKeys: ["app", "docs"] }],
      thread: { environmentId: server, projectId: ProjectId.make("app-server") },
      machineLabel: "Build box",
    });
    expect(
      sections.map((section) => ({
        label: section.label,
        targets: section.targets.map((target) => [
          target.group.projectKey,
          target.project?.id ?? null,
          target.disabledReason,
        ]),
      })),
    ).toEqual([
      {
        label: "Work",
        targets: [
          ["app", "app-server", "Current project"],
          ["docs", null, "Not on Build box"],
        ],
      },
      { label: "Ungrouped", targets: [["infra", "infra-server", null]] },
    ]);
  });

  it("names the only section Projects when the sidebar has no groups", () => {
    const sections = buildThreadMoveTargetSections({
      groups: [group("infra", [[server, "infra-server"]])],
      folders: [],
      thread: { environmentId: server, projectId: ProjectId.make("app-server") },
      machineLabel: "Build box",
    });
    expect(sections.map((section) => section.label)).toEqual(["Projects"]);
  });
});

describe("detachConfirmationMessage", () => {
  it("mentions uncommitted changes only when the server knows there are some", () => {
    const base = {
      threadTitle: "Fix login",
      targetTitle: "docs",
      inWorktree: true,
      branch: "fix-login",
    };
    expect(detachConfirmationMessage({ ...base, dirty: true })).toBe(
      [
        'Move "Fix login" to docs?',
        "The thread leaves its worktree and continues in the project folder. The worktree and its branch stay on disk.",
        "The worktree has uncommitted changes. They stay in the worktree.",
      ].join("\n"),
    );
    expect(detachConfirmationMessage({ ...base, dirty: undefined })).not.toContain("uncommitted");
    expect(detachConfirmationMessage({ ...base, inWorktree: false, dirty: false })).toContain(
      "leaves branch fix-login",
    );
  });
});
