import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import {
  importPlacement,
  matchImportProject,
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
import { threadEnvironment } from "../../state/threads";
import { readChatImports } from "../../lib/chatExport";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";

function summary(
  counts: { imported: number; present: number; moved: number; fallback: number },
  fallbackTitle: string,
) {
  return [
    `Imported ${counts.imported}`,
    counts.present > 0 && `${counts.present} already present`,
    counts.moved > 0 && `${counts.moved} moved to their project`,
    counts.fallback > 0 && `${counts.fallback} in ${fallbackTitle}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ChatImportSettings() {
  const connected = useConnectedEnvironmentIds();
  const projects = useProjects().filter(
    (p) => connected.includes(p.environmentId) && !p.archivedAt,
  );
  const configs = useServerConfigs();
  const providers = useEnvironmentProviders();
  const [target, setTarget] = useState("");
  const project = projects.find((p) => `${p.environmentId}:${p.id}` === target) ?? projects[0];
  const allowed = useAtomValue(
    orchestrationEnvironment.importThread.permissionAtom(project?.environmentId ?? null),
  );
  const runImport = useAtomCommand(orchestrationEnvironment.importThread, { reportFailure: false });
  const runMove = useAtomCommand(threadEnvironment.moveToProject, { reportFailure: false });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = (p: (typeof projects)[number]) =>
    connected.length > 1
      ? `${readEnvironment(p.environmentId)?.label ?? p.environmentId} / ${p.title}`
      : p.title;

  const importFiles = async (files: FileList, fallback: (typeof projects)[number]) => {
    const bundles = await readChatImports(files);
    const candidates = projects.filter((p) => p.environmentId === fallback.environmentId);
    const counts = { imported: 0, present: 0, moved: 0, fallback: 0 };
    const fallbackTitle = label(fallback);
    const stop = (message: string) =>
      setStatus(`${message} ${summary(counts, fallbackTitle)} so far`);
    for (const bundle of bundles) {
      const matched = matchImportProject(bundle.project, candidates)?.project ?? null;
      const destination = matched ?? fallback;
      const config = configs.get(destination.environmentId);
      if (!config) return stop("Destination environment is unavailable.");
      const modelSelection =
        destination.defaultModelSelection ??
        config.settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(
          providers.get(destination.environmentId) ?? [],
          config.settings,
          destination.id,
        );
      if (!modelSelection)
        return stop("Configure a provider on the destination environment first.");
      const result = await runImport({
        environmentId: destination.environmentId,
        input: { bundle, projectId: destination.id, modelSelection },
      });
      if (!AsyncResult.isSuccess(result))
        return stop("Import failed. Check destination permissions and server version.");
      const placement = importPlacement({
        existing: result.value.existing,
        fallbackProjectId: fallback.id,
        matchedProjectId: matched?.id ?? null,
      });
      if (placement === "imported") {
        counts.imported++;
        if (!matched) counts.fallback++;
      } else if (
        placement === "move" &&
        matched &&
        AsyncResult.isSuccess(
          await runMove({
            environmentId: destination.environmentId,
            input: { threadId: portableImportThreadId(bundle), projectId: matched.id },
          }),
        )
      ) {
        counts.moved++;
      } else {
        counts.present++;
        if (result.value.existing?.projectId === fallback.id && matched?.id !== fallback.id)
          counts.fallback++;
      }
      setStatus(`${summary(counts, fallbackTitle)} of ${bundles.length}`);
    }
    setStatus(summary(counts, fallbackTitle));
  };

  return (
    <SettingsRow
      title="Import chats"
      description="Each chat goes to the project with the same repository, folder or name. The rest go to the destination."
      status={status ? <span role="status">{status}</span> : null}
      control={
        <>
          <Select
            value={project ? `${project.environmentId}:${project.id}` : ""}
            onValueChange={(value) => {
              if (typeof value === "string") setTarget(value);
            }}
            disabled={busy || projects.length === 0}
          >
            <SelectTrigger size="sm" aria-label="Import destination">
              <SelectValue>
                {(value: string) => {
                  const selected = projects.find((p) => `${p.environmentId}:${p.id}` === value);
                  return selected ? label(selected) : "No projects";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {projects.map((p) => (
                <SelectItem key={`${p.environmentId}:${p.id}`} value={`${p.environmentId}:${p.id}`}>
                  {label(p)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !project || !allowed}
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
            onChange={(e) => {
              const files = e.target.files;
              if (!files || !project) return;
              setBusy(true);
              setStatus("Reading chats…");
              void importFiles(files, project)
                .catch(() => setStatus("Could not read these files."))
                .finally(() => {
                  setBusy(false);
                  if (input.current) input.current.value = "";
                });
            }}
          />
        </>
      }
    />
  );
}
