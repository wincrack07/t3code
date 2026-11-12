import { PROJECT_GROUP_SUGGESTION_MAX_PROJECTS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectGroupProposal,
  projectGroupSuggestionInput,
  ungroupedProjectCandidates,
} from "./projectGroupProposal";

const folders = [{ id: "a", name: "Clients", emoji: "", projectKeys: ["mac:grouped"] }];
const candidates = [
  { projectKey: "mac:grouped", displayName: "Grouped" },
  { projectKey: "mac:scratch", displayName: "Scratch", isScratch: true },
  { projectKey: "mac:shop-api", displayName: "Shop: API" },
  {
    projectKey: "server:shop-web",
    displayName: "Shop: Web",
    repositoryIdentity: {
      canonicalKey: "github.com/acme/shop-web",
      locator: { source: "git-remote", remoteName: "origin", remoteUrl: "x" },
      owner: "acme",
      name: "shop-web",
      rootPath: "/home/user/shop-web",
    },
  },
] as Parameters<typeof ungroupedProjectCandidates>[0];

describe("project group proposals", () => {
  it("asks about ungrouped projects with titles and owner/name only, up to the cap", () => {
    const ungrouped = ungroupedProjectCandidates(candidates, folders);
    expect(projectGroupSuggestionInput(ungrouped, folders)).toEqual({
      projects: [
        { key: "mac:shop-api", title: "Shop: API" },
        { key: "server:shop-web", title: "Shop: Web", repository: "acme/shop-web" },
      ],
      groups: [{ id: "a", name: "Clients" }],
    });
    const many = Array.from({ length: PROJECT_GROUP_SUGGESTION_MAX_PROJECTS + 5 }, (_, index) => ({
      projectKey: `k${index}`,
      displayName: `p${index}`,
    }));
    expect(projectGroupSuggestionInput(many, []).projects).toHaveLength(
      PROJECT_GROUP_SUGGESTION_MAX_PROJECTS,
    );
    expect(
      buildProjectGroupProposal(
        { _tag: "Suggested", model: "Haiku", assignments: [], groups: [] },
        many,
        [],
      ).omitted,
    ).toBe(5);
  });

  it("falls back to shared name prefixes and says why", () => {
    const ungrouped = ungroupedProjectCandidates(candidates, folders);
    for (const result of [{ _tag: "Unavailable", reason: "timeout" } as const, null]) {
      expect(buildProjectGroupProposal(result, ungrouped, folders)).toEqual({
        source: { kind: "prefix", reason: result?.reason ?? "no-environment" },
        omitted: 0,
        rows: [
          {
            id: "prefix-0",
            kind: "new",
            name: "Shop",
            checked: true,
            projects: [
              { key: "mac:shop-api", title: "Shop: API", checked: true },
              { key: "server:shop-web", title: "Shop: Web", checked: true },
            ],
          },
        ],
      });
    }
  });

  it("lists model groups first and skips groups or projects that have since gone", () => {
    const proposal = buildProjectGroupProposal(
      {
        _tag: "Suggested",
        model: "Haiku",
        assignments: [
          { groupId: "a", projectKeys: ["mac:shop-api", "mac:gone"] },
          { groupId: "deleted", projectKeys: ["server:shop-web"] },
        ],
        groups: [{ ref: "n1", name: "Web", parentGroupId: "a", projectKeys: ["server:shop-web"] }],
      },
      ungroupedProjectCandidates(candidates, folders),
      folders,
    );
    expect(
      proposal.rows.map((row) => [row.kind, row.name, row.projects.map((p) => p.key)]),
    ).toEqual([
      ["new", "Web", ["server:shop-web"]],
      ["existing", "Clients", ["mac:shop-api"]],
    ]);
  });
});
