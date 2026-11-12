import {
  PROJECT_GROUP_SUGGESTION_MAX_PROJECTS,
  type ProjectGroupSuggestionInput,
  type ProjectGroupSuggestionResult,
  type RepositoryIdentity,
} from "@t3tools/contracts";

import {
  projectFolderPath,
  suggestProjectFolders,
  type ProjectFolder,
  type ProjectGroupProposalRow,
} from "./projectFolders";

export type ProjectGroupCandidate = {
  projectKey: string;
  displayName: string;
  isScratch?: boolean | undefined;
  repositoryIdentity?: RepositoryIdentity | null | undefined;
};

export type ProjectGroupProposalSource =
  | { kind: "model"; model: string }
  | {
      kind: "prefix";
      /** Why the model did not answer; absent when none was asked. */
      reason:
        | Extract<ProjectGroupSuggestionResult, { _tag: "Unavailable" }>["reason"]
        | "no-environment";
    };

export type ProjectGroupProposal = {
  source: ProjectGroupProposalSource;
  rows: ProjectGroupProposalRow[];
  /** Ungrouped projects past the request cap, left out of the model's suggestion. */
  omitted: number;
};

export function ungroupedProjectCandidates<T extends ProjectGroupCandidate>(
  projects: readonly T[],
  folders: readonly ProjectFolder[],
): T[] {
  const assigned = new Set(folders.flatMap((folder) => folder.projectKeys));
  return projects.filter((project) => !project.isScratch && !assigned.has(project.projectKey));
}

/** Titles and `owner/name` only: no paths, threads or environment details reach the model. */
export function projectGroupSuggestionInput(
  candidates: readonly ProjectGroupCandidate[],
  folders: readonly ProjectFolder[],
): ProjectGroupSuggestionInput {
  return {
    projects: candidates.slice(0, PROJECT_GROUP_SUGGESTION_MAX_PROJECTS).map((project) => {
      const owner = project.repositoryIdentity?.owner;
      const name = project.repositoryIdentity?.name;
      return {
        key: project.projectKey,
        title: project.displayName.slice(0, 200),
        ...(owner && name ? { repository: `${owner}/${name}`.slice(0, 200) } : {}),
      };
    }),
    groups: folders.map((folder) => ({
      id: folder.id,
      name: folder.name.slice(0, 200),
      ...(folder.parentId === undefined ? {} : { parentId: folder.parentId }),
    })),
  };
}

/** `result` is null when no environment could be asked; then shared name prefixes decide. */
export function buildProjectGroupProposal(
  result: ProjectGroupSuggestionResult | null,
  candidates: readonly ProjectGroupCandidate[],
  folders: readonly ProjectFolder[],
): ProjectGroupProposal {
  const titles = new Map(candidates.map((project) => [project.projectKey, project.displayName]));
  const projects = (keys: readonly string[]) =>
    keys.flatMap((key) => {
      const title = titles.get(key);
      return title === undefined ? [] : [{ key, title, checked: true }];
    });
  if (result?._tag === "Suggested") {
    const rows: ProjectGroupProposalRow[] = [
      ...result.groups.map((group) => ({
        id: group.ref,
        kind: "new" as const,
        name: group.name,
        ...(group.parentGroupId === undefined ? {} : { parentGroupId: group.parentGroupId }),
        ...(group.parentRef === undefined ? {} : { parentRef: group.parentRef }),
        checked: true,
        projects: projects(group.projectKeys),
      })),
      ...result.assignments.flatMap((assignment) =>
        folders.some((folder) => folder.id === assignment.groupId)
          ? [
              {
                id: assignment.groupId,
                kind: "existing" as const,
                name: projectFolderPath(folders, assignment.groupId),
                checked: true,
                projects: projects(assignment.projectKeys),
              },
            ]
          : [],
      ),
    ];
    return {
      source: { kind: "model", model: result.model },
      rows,
      omitted: Math.max(0, candidates.length - PROJECT_GROUP_SUGGESTION_MAX_PROJECTS),
    };
  }
  return {
    source: { kind: "prefix", reason: result?.reason ?? "no-environment" },
    rows: suggestProjectFolders(candidates, folders).map((entry, index) => ({
      id: `prefix-${index}`,
      kind: "new",
      name: entry.name,
      checked: true,
      projects: projects(entry.projectKeys),
    })),
    omitted: 0,
  };
}
