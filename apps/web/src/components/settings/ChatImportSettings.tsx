import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useSyncExternalStore } from "react";
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
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { ChatImportWizard } from "./ChatImportWizard";
import {
  chatIncluded,
  discardImportSession,
  foldersReady,
  getImportSession,
  getImportStatus,
  importChats,
  importFileLabel,
  importProgressLabel,
  markChatsDone,
  mergeDestinations,
  NEW_PROJECT,
  openImportSession,
  patchImportSession,
  remainingChats,
  requestStopImport,
  resumeImportSession,
  closeImportSession,
  savedImportFileLabel,
  subscribeImportSession,
  takeStopImport,
  type ImportDraft,
} from "./ChatImportSettings.logic";

export function ChatImportSettings() {
  const connected = useConnectedEnvironmentIds();
  const projects = useProjects().filter(
    (project) => connected.includes(project.environmentId) && !project.archivedAt,
  );
  const configs = useServerConfigs();
  const providers = useEnvironmentProviders();
  const session = useSyncExternalStore(subscribeImportSession, getImportSession, () => null);
  const status = useSyncExternalStore(subscribeImportSession, getImportStatus, () => "");
  const [target, setTarget] = useState("");
  const [reading, setReading] = useState(false);
  const environmentId =
    connected.find((id) => id === (session?.environmentId ?? target)) ?? connected[0] ?? null;
  const destinationId = session?.environmentId ?? environmentId;
  const candidates = projects.filter((project) => project.environmentId === destinationId);
  const groups = planImportProjects(session?.bundles ?? [], candidates);
  const chats = importChats(session?.bundles ?? []);
  const allowed = useAtomValue(orchestrationEnvironment.importThread.permissionAtom(destinationId));
  const canCreate = useAtomValue(projectEnvironment.create.permissionAtom(destinationId));
  const canMove = useAtomValue(threadEnvironment.moveToProject.permissionAtom(destinationId));
  const runImport = useAtomCommand(orchestrationEnvironment.importThread, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const runMove = useAtomCommand(threadEnvironment.moveToProject, { reportFailure: false });
  const input = useRef<HTMLInputElement>(null);
  const savedLabel = session ? null : savedImportFileLabel();
  const left = session ? remainingChats(chats, session.draft).length : 0;
  const rowStatus =
    session && !session.open
      ? session.status || `${session.fileLabel} · ${left} chats left. Continue when you want.`
      : session
        ? ""
        : status ||
          (savedLabel
            ? `${savedLabel} is saved on this browser. Choose that same backup to continue.`
            : "");

  const retarget = (next: EnvironmentId) => {
    const current = getImportSession();
    if (!current || current.busy) return;
    const nextCandidates = projects.filter((project) => project.environmentId === next);
    patchImportSession({
      environmentId: next,
      draft: {
        ...current.draft,
        destinations: mergeDestinations(
          planImportProjects(current.bundles, nextCandidates),
          current.draft.destinations,
          new Set(nextCandidates.map((project) => project.id)),
        ),
      },
    });
  };

  const importSelected = async (plan: {
    readonly bundles: readonly T3ThreadExport[];
    readonly environmentId: EnvironmentId;
    readonly draft: ImportDraft;
  }) => {
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
    const known = projects.filter((project) => project.environmentId === plan.environmentId);
    const planGroups = planImportProjects(plan.bundles, known);
    const refs = importChats(plan.bundles);
    let draft = plan.draft;
    if (!foldersReady(draft, planGroups, refs, new Set(known.map((project) => project.id))))
      throw new Error(
        "Choose a full folder path on the destination environment, such as ~/Projects.",
      );
    const pending = remainingChats(refs, draft);
    const needed = new Set(pending.map((chat) => chat.projectKey));
    const destinations = new Map<string, { id: ProjectId; model: ModelSelection }>();
    for (const group of planGroups) {
      if (takeStopImport()) throw new Error("Stopped. Your progress is saved.");
      if (!needed.has(group.key)) continue;
      const chosen = draft.destinations[group.key];
      if (chosen === NEW_PROJECT) {
        const workspaceRoot = getCloneDestinationPath(draft.baseDirectory.trim(), group.folderName);
        const existing = findProjectByPath(known, workspaceRoot);
        if (existing) {
          destinations.set(group.key, {
            id: existing.id,
            model: existing.defaultModelSelection ?? defaultModel,
          });
          continue;
        }
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
          throw new Error(
            `Could not add ${workspaceRoot}. No chats from this attempt were imported.`,
          );
        destinations.set(group.key, { id, model: defaultModel });
      } else {
        const project = known.find((item) => item.id === chosen);
        if (!project) throw new Error(`Choose a folder for ${group.source.title}.`);
        destinations.set(group.key, {
          id: project.id,
          model: project.defaultModelSelection ?? defaultModel,
        });
      }
    }
    const counts = { imported: 0, present: 0, moved: 0 };
    for (const bundle of plan.bundles) {
      if (takeStopImport()) throw new Error("Stopped. Your progress is saved.");
      const id = portableImportThreadId(bundle);
      const key = importProjectKey(bundle.project);
      if (draft.doneChats.has(id) || !chatIncluded(draft, key, id)) continue;
      const destination = destinations.get(key);
      if (!destination) throw new Error(`Choose a folder for ${bundle.project.title}.`);
      const result = await runImport({
        environmentId: plan.environmentId,
        input: { bundle, projectId: destination.id, modelSelection: destination.model },
      });
      if (!AsyncResult.isSuccess(result))
        throw new Error(`Import stopped. ${importProgressLabel(counts)} so far.`);
      const placement = importPlacement({
        existing: result.value.existing,
        fallbackProjectId: result.value.existing?.projectId ?? destination.id,
        matchedProjectId: draft.moveExisting ? destination.id : null,
      });
      if (placement === "imported") counts.imported++;
      else if (placement === "move") {
        const moved = await runMove({
          environmentId: plan.environmentId,
          input: {
            threadId: result.value.threadId ?? id,
            projectId: destination.id,
          },
        });
        if (!AsyncResult.isSuccess(moved))
          throw new Error(`Could not move ${bundle.title}. ${importProgressLabel(counts)} so far.`);
        counts.moved++;
      } else counts.present++;
      draft = markChatsDone(draft, [id]);
      const label = importProgressLabel(counts);
      if (remainingChats(refs, draft).length === 0) {
        discardImportSession(label);
        return;
      }
      patchImportSession({
        draft,
        status: `${label} of ${pending.length}`,
      });
    }
    if (takeStopImport()) throw new Error("Stopped. Your progress is saved.");
    const label = importProgressLabel(counts);
    patchImportSession({
      draft,
      busy: false,
      open: true,
      status: `${label}. You can continue later.`,
    });
  };

  return (
    <SettingsRow
      title="Import chats"
      description="Choose which chats to restore and the folder for each source project. A backup you leave unfinished stays here until you continue or discard it."
      status={rowStatus ? <span role="status">{rowStatus}</span> : null}
      control={
        <>
          <Select
            value={environmentId ?? ""}
            onValueChange={(value) => {
              const next = connected.find((id) => id === value);
              if (!next) return;
              setTarget(next);
              retarget(next);
            }}
            disabled={reading || session?.busy === true || connected.length === 0}
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
            disabled={reading || session?.busy === true || !environmentId || !allowed}
            onClick={() => input.current?.click()}
          >
            Import chats…
          </Button>
          {session && !session.open ? (
            <Button
              size="sm"
              variant="outline"
              disabled={session.busy}
              onClick={resumeImportSession}
            >
              Continue{left > 0 ? ` (${left})` : ""}
            </Button>
          ) : null}
          {session && !session.busy ? (
            <Button size="sm" variant="ghost" onClick={() => discardImportSession()}>
              Discard
            </Button>
          ) : null}
          <input
            ref={input}
            type="file"
            accept=".t3thread.json,.zip"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (!files || !environmentId || getImportSession()?.busy) return;
              const names = [...files].map((file) => file.name);
              const chosenEnvironment = environmentId;
              setReading(true);
              void readChatImports(files)
                .then((bundles) => {
                  const known = projects.filter(
                    (project) => project.environmentId === chosenEnvironment,
                  );
                  openImportSession({
                    bundles,
                    fileLabel: importFileLabel(names),
                    environmentId: chosenEnvironment,
                    groups: planImportProjects(bundles, known),
                    knownProjectIds: new Set(known.map((project) => project.id)),
                    baseDirectory:
                      configs.get(chosenEnvironment)?.settings.addProjectBaseDirectory ?? "",
                  });
                })
                .catch(() => {
                  const current = getImportSession();
                  if (current)
                    patchImportSession({ status: "Could not read these files.", busy: false });
                  else discardImportSession("Could not read these files.");
                })
                .finally(() => {
                  setReading(false);
                  if (input.current) input.current.value = "";
                });
            }}
          />
          {session?.open ? (
            <ChatImportWizard
              key={session.fingerprint}
              session={session}
              groups={groups}
              chats={chats}
              candidates={candidates}
              canCreate={canCreate}
              canMove={canMove}
              allowed={allowed}
              onDraft={(draft) => patchImportSession({ draft, status: "" })}
              onClose={closeImportSession}
              onStop={requestStopImport}
              onImport={() => {
                const current = getImportSession();
                if (!current || current.busy) return;
                // Let the click finish before the button becomes Stop.
                void Promise.resolve()
                  .then(() => {
                    patchImportSession({ busy: true, status: "Importing chats…", open: true });
                    return importSelected(getImportSession() ?? current);
                  })
                  .catch((error: unknown) => {
                    patchImportSession({
                      busy: false,
                      status: error instanceof Error ? error.message : "Import failed.",
                    });
                  });
              }}
            />
          ) : null}
        </>
      }
    />
  );
}
