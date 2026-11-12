import { useState } from "react";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { moveProjectsToFolder, type ProjectFolder } from "../../projectFolders";
import { ProjectFolderEditor, ProjectFolderSuggestions } from "../sidebar/ProjectFolderEditor";
import { ProjectFolderMenu } from "../sidebar/ProjectFolderMenu";
import { Button } from "../ui/button";
import { Menu, MenuTrigger, MenuPopup } from "../ui/menu";

export function ProjectFoldersSettings() {
  const projects = useSidebarProjectGroups();
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const update = useUpdatePrimarySettings();
  const [editor, setEditor] = useState<{ folder?: ProjectFolder; projectKeys?: string[] } | null>(
    null,
  );
  const [suggest, setSuggest] = useState(false);
  return (
    <section className="space-y-4 p-6">
      <h2 className="text-sm font-medium">Project groups</h2>
      <p className="text-sm text-muted-foreground">
        Organize projects across environments. Deleting a group keeps its projects.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditor({})}>
          New group
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSuggest(true)}>
          Suggest groups
        </Button>
      </div>
      {folders.map((folder) => (
        <div key={folder.id} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm">
              {folder.emoji} {folder.name}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setEditor({ folder })}>
              Rename
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                update({ sidebarProjectFolders: folders.filter((entry) => entry.id !== folder.id) })
              }
            >
              Delete
            </Button>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {folder.projectKeys.map((key) => (
              <li key={key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {projects.find((project) => project.projectKey === key)?.displayName ??
                    "Unavailable project"}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    update({ sidebarProjectFolders: moveProjectsToFolder(folders, [key], null) })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {projects.map((project) => (
        <div key={project.projectKey} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>
              Group {project.displayName}
            </MenuTrigger>
            <MenuPopup>
              <ProjectFolderMenu
                folders={folders}
                assigned={folders.some((folder) => folder.projectKeys.includes(project.projectKey))}
                onMove={(id) =>
                  update({
                    sidebarProjectFolders: moveProjectsToFolder(folders, [project.projectKey], id),
                  })
                }
                onCreate={() => setEditor({ projectKeys: [project.projectKey] })}
              />
            </MenuPopup>
          </Menu>
        </div>
      ))}
      {editor ? <ProjectFolderEditor {...editor} onClose={() => setEditor(null)} /> : null}
      {suggest ? (
        <ProjectFolderSuggestions projects={projects} onClose={() => setSuggest(false)} />
      ) : null}
    </section>
  );
}
