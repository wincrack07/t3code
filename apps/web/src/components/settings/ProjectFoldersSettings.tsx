import { useState } from "react";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useClientSettings } from "../../hooks/useSettings";
import {
  projectFolderOfProject,
  projectFolderPath,
  projectFolderTree,
  type ProjectFolder,
} from "../../projectFolders";
import { deleteSidebarFolder, moveSidebarProjectToFolder } from "../sidebar/projectFolderActions";
import { ProjectFolderEditor, ProjectFolderSuggestions } from "../sidebar/ProjectFolderEditor";
import { ProjectFolderMenu } from "../sidebar/ProjectFolderMenu";
import { Button } from "../ui/button";
import { Menu, MenuTrigger, MenuPopup } from "../ui/menu";

export function ProjectFoldersSettings() {
  const projects = useSidebarProjectGroups();
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const [editor, setEditor] = useState<{ folder?: ProjectFolder; projectKeys?: string[] } | null>(
    null,
  );
  const [suggest, setSuggest] = useState(false);
  return (
    <section className="space-y-4 p-6">
      <h2 className="text-sm font-medium">Project groups</h2>
      <p className="text-sm text-muted-foreground">
        Organize projects across environments. Deleting a group moves its projects and subgroups up
        a level.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditor({})}>
          New group
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSuggest(true)}>
          Suggest groups
        </Button>
      </div>
      {projectFolderTree(folders).map(({ folder }) => (
        <div key={folder.id} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm">
              {folder.emoji} {projectFolderPath(folders, folder.id)}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setEditor({ folder })}>
              Rename
            </Button>
            <Button size="xs" variant="ghost" onClick={() => deleteSidebarFolder(folder.id)}>
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
                  onClick={() => moveSidebarProjectToFolder(key, null)}
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
                currentFolderId={projectFolderOfProject(folders, project.projectKey)?.id ?? null}
                onMove={(id) => moveSidebarProjectToFolder(project.projectKey, id)}
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
