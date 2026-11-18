/* oxlint-disable t3code/no-untranslated-copy -- fork-only screen; its copy stays English until the fork translates it. */
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { CommandId } from "@t3tools/contracts";
import { getCloneDestinationPath } from "@t3tools/client-runtime/operations/projects";
import { getBrowseParentPath } from "@t3tools/client-runtime/state/projects";
import { fileBasename } from "@t3tools/shared/path";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { WorkspaceFolderPicker } from "../WorkspaceFolderPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import type { Project } from "../../types";
import { persistClientSettingsUpdate } from "../../hooks/useSettings";
import { movedProjectClientSettings } from "./ProjectSettingsPanel.logic";
import { toastManager } from "../ui/toast";

export function MoveProjectFolderButton({ project }: { project: Project }) {
  const { environmentId, id: projectId, workspaceRoot, title } = project;
  const allowed = useAtomValue(projectEnvironment.moveWorkspace.permissionAtom(environmentId));
  const move = useAtomCommand(projectEnvironment.moveWorkspace, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destination = getCloneDestinationPath(parent.trim(), fileBasename(workspaceRoot));
  const { presentation } = useEnvironmentPresentation(environmentId);
  if (presentation?.serverConfig?.environment.capabilities.projectWorkspaceMove !== true)
    return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!allowed}
        aria-label={`Move folder ${workspaceRoot}`}
        onClick={() => {
          setParent(getBrowseParentPath(workspaceRoot) ?? "");
          setError(null);
          setOpen(true);
        }}
      >
        Move folder…
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Move {title}</DialogTitle>
            <DialogDescription>
              Move the project folder and its contents on this environment. Chats stay with the
              project. Disconnect its agent sessions from Previous agents before moving.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Current folder</p>
                <p className="break-all text-sm text-muted-foreground">{workspaceRoot}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`move-project-parent-${projectId}`}>Destination folder</Label>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id={`move-project-parent-${projectId}`}
                    value={parent}
                    disabled={busy}
                    onChange={(event) => setParent(event.target.value)}
                  />
                  <WorkspaceFolderPicker
                    environmentId={environmentId}
                    value={parent}
                    disabled={busy}
                    onChange={setParent}
                  />
                </div>
              </div>
              {parent.trim() ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">New location</p>
                  <p className="break-all text-sm text-muted-foreground">{destination}</p>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!allowed || busy || !parent.trim() || destination === workspaceRoot}
              onClick={() => {
                setBusy(true);
                setError(null);
                void move({
                  environmentId,
                  input: {
                    commandId: CommandId.make(randomUUID()),
                    projectId,
                    destinationParent: parent.trim(),
                  },
                }).then(async (result) => {
                  setBusy(false);
                  if (AsyncResult.isSuccess(result)) {
                    setOpen(false);
                    try {
                      await persistClientSettingsUpdate((current) =>
                        movedProjectClientSettings(current, project, result.value.workspaceRoot),
                      );
                    } catch {
                      toastManager.add({
                        type: "warning",
                        title: "Folder moved; sidebar preferences could not be updated",
                      });
                    }
                    toastManager.add({
                      type: "success",
                      title: "Project folder moved",
                      description: result.value.workspaceRoot,
                    });
                  } else {
                    const failure = squashAtomCommandFailure(result);
                    setError(
                      failure instanceof Error ? failure.message : "Could not move this folder.",
                    );
                  }
                });
              }}
            >
              {busy ? "Moving…" : "Move folder"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
