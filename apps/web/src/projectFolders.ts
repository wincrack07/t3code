import type { ClientSettings } from "@t3tools/contracts";

export type ProjectFolder = ClientSettings["sidebarProjectFolders"][number];

export function moveProjectsToFolder(
  folders: readonly ProjectFolder[],
  projectKeys: readonly string[],
  folderId: string | null,
): ProjectFolder[] {
  if (folderId !== null && !folders.some((folder) => folder.id === folderId)) return [...folders];
  const keys = new Set(projectKeys);
  return folders.map((folder) => ({
    ...folder,
    projectKeys: [
      ...folder.projectKeys.filter((key) => !keys.has(key)),
      ...(folder.id === folderId ? [...keys] : []),
    ],
  }));
}

export function suggestProjectFolders(
  projects: readonly { projectKey: string; displayName: string }[],
  folders: readonly ProjectFolder[],
) {
  const assigned = new Set(folders.flatMap((folder) => folder.projectKeys));
  const prefixes = new Map<string, { name: string; projectKeys: string[] }>();
  for (const project of projects) {
    if (assigned.has(project.projectKey)) continue;
    const match = /^(.+?)(?:\s*[:·]\s*|\s+-\s+)\S/.exec(project.displayName);
    const name = match?.[1]?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const entry = prefixes.get(key) ?? { name, projectKeys: [] };
    entry.projectKeys.push(project.projectKey);
    prefixes.set(key, entry);
  }
  return [...prefixes.values()].filter((entry) => entry.projectKeys.length > 1);
}

// The first member in the existing sorted project list anchors its folder, including pins.
export function arrangeProjectFolders<T extends { group: { projectKey: string } }>(
  projects: readonly T[],
  folders: readonly ProjectFolder[],
): ({ kind: "project"; project: T } | { kind: "folder"; folder: ProjectFolder; projects: T[] })[] {
  const owners = new Map<string, ProjectFolder>();
  for (const folder of folders) {
    for (const key of folder.projectKeys) if (!owners.has(key)) owners.set(key, folder);
  }
  const emitted = new Set<string>();
  return projects.flatMap<
    { kind: "project"; project: T } | { kind: "folder"; folder: ProjectFolder; projects: T[] }
  >((project) => {
    const folder = owners.get(project.group.projectKey);
    if (!folder) return [{ kind: "project" as const, project }];
    if (emitted.has(folder.id)) return [];
    emitted.add(folder.id);
    return [
      {
        kind: "folder" as const,
        folder,
        projects: projects.filter(
          (candidate) => owners.get(candidate.group.projectKey)?.id === folder.id,
        ),
      },
    ];
  });
}
