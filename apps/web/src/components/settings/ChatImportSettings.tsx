import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId, ModelSelection, ProjectId, T3ThreadExport } from "@t3tools/contracts";
import { getCloneDestinationPath } from "@t3tools/client-runtime/operations/projects";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import {
  importPlacement,
  importProjectKey,
  planImportProjects,
  portableImportThreadId,
} from "@t3tools/shared/threadExport";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { useProjects, useServerConfigs } from "../../state/entities";
import {
  useConnectedEnvironmentIds,
  readEnvironment,
  useEnvironmentProviders,
} from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import { projectEnvironment } from "../../state/projects";
import { threadEnvironment } from "../../state/threads";
import { readChatImports } from "../../lib/chatExport";
import { newProjectId } from "../../lib/utils";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { WorkspaceFolderPicker } from "../WorkspaceFolderPicker";

const NEW_PROJECT = "new";
interface ImportReview {
  readonly environmentId: EnvironmentId;
  readonly bundles: ReadonlyArray<T3ThreadExport>;
  readonly destinations: Readonly<Record<string, string>>;
  readonly baseDirectory: string;
  readonly moveExisting: boolean;
}

export function ChatImportSettings() {
  const connected = useConnectedEnvironmentIds();
  const projects = useProjects().filter(
    (p) => connected.includes(p.environmentId) && !p.archivedAt,
  );
  const configs = useServerConfigs();
  const providers = useEnvironmentProviders();
  const [target, setTarget] = useState("");
  const environmentId = connected.find((id) => id === target) ?? connected[0] ?? null;
  const [review, setReview] = useState<ImportReview | null>(null);
  const destinationId = review?.environmentId ?? environmentId;
  const candidates = projects.filter((p) => p.environmentId === destinationId);
  const groups = planImportProjects(review?.bundles ?? [], candidates);
  const allowed = useAtomValue(orchestrationEnvironment.importThread.permissionAtom(destinationId));
  const canCreate = useAtomValue(projectEnvironment.create.permissionAtom(destinationId));
  const canMove = useAtomValue(threadEnvironment.moveToProject.permissionAtom(destinationId));
  const runImport = useAtomCommand(orchestrationEnvironment.importThread, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const runMove = useAtomCommand(threadEnvironment.moveToProject, { reportFailure: false });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const createsProjects = groups.some((group) => review?.destinations[group.key] === NEW_PROJECT);

  const importChats = async (plan: ImportReview) => {
    const base = plan.baseDirectory.trim();
    if (
      createsProjects &&
      !base.startsWith("/") &&
      !base.startsWith("~/") &&
      !isWindowsAbsolutePath(base)
    ) {
      throw new Error(
        "Choose a full folder path on the destination environment, such as ~/Projects.",
      );
    }
    const config = configs.get(plan.environmentId);
    if (!config) throw new Error("The destination environment is unavailable.");
    const defaultModel =
      config.settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(
        providers.get(plan.environmentId) ?? [],
        config.settings,
        null,
      );
    if (!defaultModel)
      throw new Error("Configure a provider on the destination environment first.");
    const destinations = new Map<string, { id: ProjectId; model: ModelSelection }>();
    for (const group of groups) {
      const chosen = plan.destinations[group.key];
      if (chosen === NEW_PROJECT) {
        const workspaceRoot = getCloneDestinationPath(plan.baseDirectory.trim(), group.folderName);
        const existing = findProjectByPath(candidates, workspaceRoot);
        if (existing)
          throw new Error(
            `${workspaceRoot} is already registered as ${existing.title}. Choose that project explicitly or select another base folder.`,
          );
        const id = newProjectId();
        const result = await createProject({
          environmentId: plan.environmentId,
          input: {
            projectId: id,
            title: group.source.title.trim().slice(0, 200) || "Imported chats",
            workspaceRoot,
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: null,
          },
        });
        if (!AsyncResult.isSuccess(result))
          throw new Error(`Could not add ${workspaceRoot}. No chats were imported.`);
        destinations.set(group.key, { id, model: defaultModel });
      } else {
        const project = candidates.find((p) => p.id === chosen);
        if (!project) throw new Error(`Choose a destination for ${group.source.title}.`);
        destinations.set(group.key, {
          id: project.id,
          model: project.defaultModelSelection ?? defaultModel,
        });
      }
    }
    const counts = { imported: 0, present: 0, moved: 0 };
    const progress = () =>
      [
        `Imported ${counts.imported}`,
        counts.present > 0 && `${counts.present} already present`,
        counts.moved > 0 && `${counts.moved} moved to their project`,
      ]
        .filter(Boolean)
        .join(" · ");
    for (const bundle of plan.bundles) {
      const destination = destinations.get(importProjectKey(bundle.project));
      if (!destination) throw new Error("A project destination is missing.");
      const result = await runImport({
        environmentId: plan.environmentId,
        input: { bundle, projectId: destination.id, modelSelection: destination.model },
      });
      if (!AsyncResult.isSuccess(result)) throw new Error(`Import stopped. ${progress()} so far.`);
      const placement = importPlacement({
        existing: result.value.existing,
        fallbackProjectId: result.value.existing?.projectId ?? destination.id,
        matchedProjectId: plan.moveExisting ? destination.id : null,
      });
      if (placement === "imported") counts.imported++;
      else if (placement === "move") {
        const moved = await runMove({
          environmentId: plan.environmentId,
          input: {
            threadId: result.value.threadId ?? portableImportThreadId(bundle),
            projectId: destination.id,
          },
        });
        if (!AsyncResult.isSuccess(moved))
          throw new Error(`Could not move ${bundle.title}. ${progress()} so far.`);
        counts.moved++;
      } else counts.present++;
      setStatus(`${progress()} of ${plan.bundles.length}`);
    }
    setStatus(progress());
    setReview(null);
  };

  return (
    <SettingsRow
      title="Import chats"
      description="Restore each source project separately. Review destinations before importing; workspace files are not copied."
      status={status ? <span role="status">{status}</span> : null}
      control={
        <>
          <Select
            value={environmentId ?? ""}
            onValueChange={(value) => setTarget(value ?? "")}
            disabled={busy || connected.length === 0}
          >
            <SelectTrigger size="sm" aria-label="Import environment">
              <SelectValue>
                {environmentId
                  ? (readEnvironment(environmentId)?.label ?? environmentId)
                  : "No environments"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {connected.map((id) => (
                <SelectItem key={id} value={id}>
                  {readEnvironment(id)?.label ?? id}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !environmentId || !allowed}
            onClick={() => input.current?.click()}
          >
            Import chats…
          </Button>
          <input
            ref={input}
            type="file"
            accept=".t3thread.json,.zip"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (!files || !environmentId) return;
              setBusy(true);
              setStatus("Reading chats…");
              void readChatImports(files)
                .then((bundles) => {
                  const plan = planImportProjects(bundles, candidates);
                  setReview({
                    environmentId,
                    bundles,
                    moveExisting: false,
                    baseDirectory:
                      configs.get(environmentId)?.settings.addProjectBaseDirectory ?? "",
                    destinations: Object.fromEntries(
                      plan.map((group) => [group.key, group.project?.id ?? NEW_PROJECT]),
                    ),
                  });
                  setStatus("");
                })
                .catch(() => setStatus("Could not read these files."))
                .finally(() => {
                  setBusy(false);
                  if (input.current) input.current.value = "";
                });
            }}
          />
          <Dialog
            open={review !== null}
            onOpenChange={(open) => {
              if (!open && !busy) setReview(null);
            }}
          >
            <DialogPopup className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import chats</DialogTitle>
                <DialogDescription>
                  {review?.bundles.length ?? 0} chats across {groups.length} projects on{" "}
                  {destinationId
                    ? (readEnvironment(destinationId)?.label ?? destinationId)
                    : "this environment"}
                  . Chat history is restored; repositories and source files are not copied.
                </DialogDescription>
              </DialogHeader>
              <DialogPanel>
                {createsProjects && review ? (
                  <div className="mb-4 space-y-2">
                    <Label htmlFor="chat-import-base-folder">Projects folder</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        id="chat-import-base-folder"
                        value={review.baseDirectory}
                        placeholder="~/Projects"
                        disabled={busy}
                        onChange={(event) =>
                          setReview(
                            (current) =>
                              current && { ...current, baseDirectory: event.target.value },
                          )
                        }
                      />
                      <WorkspaceFolderPicker
                        environmentId={review.environmentId}
                        value={review.baseDirectory}
                        disabled={busy}
                        onChange={(baseDirectory) =>
                          setReview((current) => current && { ...current, baseDirectory })
                        }
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Each missing project gets a folder inside this directory. Existing folders are
                      kept.
                    </p>
                  </div>
                ) : null}
                <div className="divide-y divide-border">
                  {groups.map((group) => (
                    <div key={group.key} className="grid min-w-0 gap-3 py-4 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium">
                          {group.source.title} · {group.count} chats
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          {group.source.repository?.canonicalKey ?? group.source.workspacePath}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Select
                          value={review?.destinations[group.key] ?? NEW_PROJECT}
                          disabled={busy}
                          onValueChange={(value) => {
                            if (value)
                              setReview(
                                (current) =>
                                  current && {
                                    ...current,
                                    destinations: { ...current.destinations, [group.key]: value },
                                  },
                              );
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Destination for ${group.source.title}`}
                          >
                            <SelectValue>
                              {review?.destinations[group.key] === NEW_PROJECT
                                ? "Separate project folder"
                                : (candidates.find((p) => p.id === review?.destinations[group.key])
                                    ?.title ?? "Choose a project")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value={NEW_PROJECT}>Separate project folder</SelectItem>
                            {candidates.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.title}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                        {review?.destinations[group.key] === NEW_PROJECT ? (
                          <p className="break-all text-xs text-muted-foreground">
                            {review.baseDirectory.trim()
                              ? getCloneDestinationPath(
                                  review.baseDirectory.trim(),
                                  group.folderName,
                                )
                              : group.folderName}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <label className="mt-4 flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={review?.moveExisting ?? false}
                    disabled={busy || !canMove}
                    onCheckedChange={(checked) =>
                      setReview(
                        (current) => current && { ...current, moveExisting: Boolean(checked) },
                      )
                    }
                  />
                  Move existing imported chats to these projects
                </label>
                {createsProjects && !canCreate ? (
                  <p role="alert" className="mt-3 text-sm text-muted-foreground">
                    This connection cannot create projects. Choose existing destinations or use a
                    connection with project permissions.
                  </p>
                ) : null}
                {status ? (
                  <p role="status" className="mt-3 text-sm text-muted-foreground">
                    {status}
                  </p>
                ) : null}
              </DialogPanel>
              <DialogFooter variant="bare">
                <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    busy ||
                    !allowed ||
                    (createsProjects && (!canCreate || !review?.baseDirectory.trim())) ||
                    (review?.moveExisting && !canMove)
                  }
                  onClick={() => {
                    if (!review) return;
                    setBusy(true);
                    setStatus("Importing chats…");
                    void importChats(review)
                      .catch((error: unknown) =>
                        setStatus(error instanceof Error ? error.message : "Import failed."),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Importing…" : "Import chats"}
                </Button>
              </DialogFooter>
            </DialogPopup>
          </Dialog>
        </>
      }
    />
  );
}
