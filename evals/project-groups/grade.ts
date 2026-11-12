import type { ProjectGroupSuggestionInput, ProposedProjectGroup } from "@t3tools/contracts";

export type Parsed = {
  assignments: readonly { groupId: string; projectKeys: readonly string[] }[];
  groups: readonly ProposedProjectGroup[];
} | null;

export type GradedCase = {
  input: ProjectGroupSuggestionInput;
  together: readonly (readonly string[])[];
  apart?: readonly string[];
  existing?: Readonly<Record<string, string>>;
  forbiddenNames?: readonly string[];
};

/** Grades what survives the production validator, as the dialog would show it. */
export function grade(fixture: GradedCase, parsed: Parsed): string[] {
  if (parsed === null) return ["reply was not the requested JSON"];
  const titleOf = new Map(fixture.input.projects.map((project) => [project.key, project.title]));
  const groupOf = new Map<string, string>();
  for (const assignment of parsed.assignments)
    for (const key of assignment.projectKeys) groupOf.set(titleOf.get(key)!, assignment.groupId);
  for (const group of parsed.groups)
    for (const key of group.projectKeys) groupOf.set(titleOf.get(key)!, `new:${group.ref}`);
  const failures: string[] = [];
  for (const titles of fixture.together) {
    const groups = new Set(titles.map((title) => groupOf.get(title)));
    if (groups.size !== 1 || groups.has(undefined))
      failures.push(`not together: ${titles.join(", ")}`);
  }
  const togetherGroups = new Set(fixture.together.flat().map((title) => groupOf.get(title)));
  for (const title of fixture.apart ?? []) {
    const group = groupOf.get(title);
    if (group === undefined) continue;
    if (togetherGroups.has(group) || fixture.together.length === 0)
      failures.push(`grouped: ${title}`);
  }
  for (const [title, groupId] of Object.entries(fixture.existing ?? {}))
    if (groupOf.get(title) !== groupId) failures.push(`not in existing ${groupId}: ${title}`);
  for (const name of fixture.forbiddenNames ?? [])
    if (parsed.groups.some((group) => group.name.toLowerCase().includes(name.toLowerCase())))
      failures.push(`followed a title: ${name}`);
  return failures;
}
