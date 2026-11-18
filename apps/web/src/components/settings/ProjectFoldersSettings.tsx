import { T, useGT } from "gt-react";
import { useState } from "react";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useClientSettings } from "../../hooks/useSettings";
import {
  projectFolderOfProject,
  projectFolderPath,
  projectFolderTree,
  projectFolderAncestors,
  type ProjectFolder,
} from "../../projectFolders";
import {
  deleteSidebarFolder,
  moveSidebarProjectToFolder,
  moveSidebarFolder,
} from "../sidebar/projectFolderActions";
import { ProjectFolderEditor } from "../sidebar/ProjectFolderEditor";
import { ProjectGroupSuggestions } from "../sidebar/ProjectGroupSuggestions";
import { ProjectFolderMenu } from "../sidebar/ProjectFolderMenu";
import { Button } from "../ui/button";
import { Menu, MenuTrigger, MenuPopup } from "../ui/menu";
import { SettingsGroup } from "./SettingsGroup";

export function ProjectFoldersSettings() {
  const gt = useGT();
  const projects = useSidebarProjectGroups();
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const [editor, setEditor] = useState<{ folder?: ProjectFolder; projectKeys?: string[] } | null>(
    null,
  );
  const [suggest, setSuggest] = useState(false);
  return (
    <section className="space-y-3">
      <div className="space-y-1 px-3 sm:px-4">
        <h2 className="flex min-h-7 items-center text-base font-semibold">
          <T>Project groups</T>
        </h2>
        <p className="text-sm text-muted-foreground">
          <T>
            Organize projects across environments. Deleting a group moves its projects and subgroups
            up a level.
          </T>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 px-3 sm:px-4">
        <Button size="sm" variant="outline" onClick={() => setEditor({})}>
          <T>New group</T>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSuggest(true)}>
          <T>Suggest groups</T>
        </Button>
      </div>
      {projectFolderTree(folders).map(({ folder }) => (
        <SettingsGroup key={folder.id} divided={false} className="space-y-1 px-3 py-2 sm:px-4">
          <div className="flex min-h-8 min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {folder.emoji} {projectFolderPath(folders, folder.id)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditor({ folder })}>
              <T context="verb, renames a project group">Rename</T>
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={gt("Move group {name}", { name: folder.name })}
                    disabled={
                      projectFolderAncestors(folders, folder.id).length === 0 &&
                      folders.every(
                        (candidate) =>
                          candidate.id === folder.id ||
                          projectFolderAncestors(folders, candidate.id).includes(folder.id),
                      )
                    }
                  />
                }
              >
                <T context="verb, moves a project group">Move</T>
              </MenuTrigger>
              <MenuPopup>
                <ProjectFolderMenu
                  folders={folders}
                  currentFolderId={projectFolderAncestors(folders, folder.id)[0] ?? null}
                  excludedFolderIds={
                    new Set(
                      folders
                        .filter(
                          (candidate) =>
                            candidate.id === folder.id ||
                            projectFolderAncestors(folders, candidate.id).includes(folder.id),
                        )
                        .map((candidate) => candidate.id),
                    )
                  }
                  onMove={(parentId) => moveSidebarFolder(folder.id, { parentId })}
                />
              </MenuPopup>
            </Menu>
            <Button size="sm" variant="ghost" onClick={() => deleteSidebarFolder(folder.id)}>
              <T context="verb, deletes a project group">Delete</T>
            </Button>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {folder.projectKeys.map((key) => (
              <li key={key} className="flex min-h-8 min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {projects.find((project) => project.projectKey === key)?.displayName ??
                    gt("Unavailable project")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => moveSidebarProjectToFolder(key, null)}
                >
                  <T context="verb, removes a project from a group">Remove</T>
                </Button>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      ))}
      {projects.length > 0 ? (
        <SettingsGroup divided={false} className="space-y-1 px-3 py-2 sm:px-4">
          {projects.map((project) => (
            <div
              key={project.projectKey}
              className="flex min-h-8 min-w-0 items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={gt("Group {name}", {
                        $context: "verb, adds a project to a group",
                        name: project.displayName,
                      })}
                    />
                  }
                >
                  <T context="verb, adds a project to a group">Group</T>
                </MenuTrigger>
                <MenuPopup>
                  <ProjectFolderMenu
                    folders={folders}
                    currentFolderId={
                      projectFolderOfProject(folders, project.projectKey)?.id ?? null
                    }
                    onMove={(id) => moveSidebarProjectToFolder(project.projectKey, id)}
                    onCreate={() => setEditor({ projectKeys: [project.projectKey] })}
                  />
                </MenuPopup>
              </Menu>
            </div>
          ))}
        </SettingsGroup>
      ) : null}
      {editor ? <ProjectFolderEditor {...editor} onClose={() => setEditor(null)} /> : null}
      {suggest ? (
        <ProjectGroupSuggestions projects={projects} onClose={() => setSuggest(false)} />
      ) : null}
    </section>
  );
}
