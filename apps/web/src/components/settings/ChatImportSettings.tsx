import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Button } from "../ui/button";
import { useProjects, useServerConfigs } from "../../state/entities";
import {
  useConnectedEnvironmentIds,
  readEnvironment,
  useEnvironmentProviders,
} from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import { readChatImports } from "../../lib/chatExport";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";

export function ChatImportSettings() {
  const connected = useConnectedEnvironmentIds();
  const projects = useProjects().filter((p) => connected.includes(p.environmentId));
  const configs = useServerConfigs();
  const providers = useEnvironmentProviders();
  const [target, setTarget] = useState("");
  const project = projects.find((p) => `${p.environmentId}:${p.id}` === target) ?? projects[0];
  const allowed = useAtomValue(
    orchestrationEnvironment.importThread.permissionAtom(project?.environmentId ?? null),
  );
  const runImport = useAtomCommand(orchestrationEnvironment.importThread, { reportFailure: false });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        Import destination
        <select
          aria-label="Import destination"
          className="ml-2 rounded border bg-background p-2"
          value={project ? `${project.environmentId}:${project.id}` : ""}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
        >
          {projects.map((p) => (
            <option key={`${p.environmentId}:${p.id}`} value={`${p.environmentId}:${p.id}`}>
              {readEnvironment(p.environmentId)?.label ?? p.environmentId} / {p.title}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        A project with the original workspace path on this environment takes priority; otherwise use
        the selected project. Imported chats can be continued. Missing attachment files are not
        restored.
      </p>
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
          void (async () => {
            const bundles = await readChatImports(files);
            let count = 0;
            for (const bundle of bundles) {
              const destination =
                projects.find(
                  (p) =>
                    p.environmentId === project.environmentId &&
                    p.workspaceRoot === bundle.project.workspacePath,
                ) ?? project;
              const config = configs.get(destination.environmentId);
              if (!config) throw new Error("Destination environment is unavailable.");
              const modelSelection =
                destination.defaultModelSelection ??
                config.settings.defaultModelSelection ??
                resolveProjectDefaultProviderModelSelection(
                  providers.get(destination.environmentId) ?? [],
                  config.settings,
                  destination.id,
                );
              if (!modelSelection)
                throw new Error("Configure a provider on the destination environment first.");
              const result = await runImport({
                environmentId: destination.environmentId,
                input: { bundle, projectId: destination.id, modelSelection },
              });
              if (!AsyncResult.isSuccess(result))
                throw new Error("Import failed. Check destination permissions and server version.");
              setStatus(`Imported ${++count} of ${bundles.length} chats (existing imports kept).`);
            }
          })()
            .catch((error) => setStatus(error instanceof Error ? error.message : "Import failed."))
            .finally(() => {
              setBusy(false);
              if (input.current) input.current.value = "";
            });
        }}
      />
      <Button disabled={busy || !project || !allowed} onClick={() => input.current?.click()}>
        Import chats…
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
