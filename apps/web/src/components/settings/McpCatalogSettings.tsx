import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  McpCatalogImportCandidate,
  McpCatalogServer,
  McpCatalogServerStatus,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { T, useGT, useMessages } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import {
  draftFor,
  draftId,
  emptyDraft,
  serverFromDraft,
  statusLabel,
  transportSummary,
  variableKey,
  type ServerDraft,
  type VariableDraft,
} from "./McpCatalogSettings.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const IMPORT_SOURCE_LABELS: Record<McpCatalogImportCandidate["source"], string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude app",
  codex: "Codex",
  cursor: "Cursor",
};

const failureMessage = (result: AsyncResult.Failure<unknown, unknown>, fallback: string) => {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error && failure.message.trim() !== "" ? failure.message : fallback;
};

export function McpCatalogSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment ? (
        <McpCatalogSection environmentId={environment.environmentId} />
      ) : (
        <SettingsSection {...searchableSetting("mcp-servers")}>
          <SettingsRow
            title={gt("Choose one environment")}
            description={gt("MCP servers belong to a single machine. Choose one above.")}
          />
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function McpCatalogSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const query = useEnvironmentQuery(serverEnvironment.mcpCatalog({ environmentId, input: {} }));
  const allowed = useAtomValue(
    serverEnvironment.upsertMcpCatalogServer.permissionAtom(environmentId),
  );
  const upsert = useAtomCommand(serverEnvironment.upsertMcpCatalogServer, {
    reportFailure: false,
  });
  const reconnect = useAtomCommand(serverEnvironment.reconnectMcpCatalogServer, {
    reportFailure: false,
  });
  const [editing, setEditing] = useState<{ readonly server: McpCatalogServer | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [rowError, setRowError] = useState<{ readonly id: string; readonly message: string }>();
  const snapshot = query.data ?? undefined;
  const statusById = new Map(snapshot?.statuses.map((status) => [status.id, status]));

  const setEnabled = async (server: McpCatalogServer, enabled: boolean) => {
    setRowError(undefined);
    const result = await upsert({
      environmentId,
      input: { previousId: server.id, server: { ...server, enabled } },
    });
    if (AsyncResult.isFailure(result)) {
      setRowError({
        id: server.id,
        message: failureMessage(result, gt("Could not save this change.")),
      });
    }
  };

  return (
    <>
      <SettingsSection
        {...searchableSetting("mcp-servers")}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={!allowed || snapshot === undefined}
            onClick={() => setImporting(true)}
          >
            <T context="verb, opens the import dialog">Import</T>
          </Button>
        }
      >
        {snapshot === undefined ? (
          <SettingsRow
            title={query.error ? gt("MCP servers are unavailable") : gt("Loading…")}
            description={query.error ?? undefined}
          />
        ) : snapshot.servers.length === 0 ? (
          <SettingsRow
            title={gt("No servers yet")}
            description={gt(
              "Add one, or import the ones Claude, Codex, and Cursor already use. Every agent here, on any account, then reaches them through T3 Code without its own copy.",
            )}
          />
        ) : (
          snapshot.servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              status={statusById.get(server.id)}
              allowed={allowed}
              error={rowError?.id === server.id ? rowError.message : undefined}
              onEnabledChange={(enabled) => void setEnabled(server, enabled)}
              onEdit={() => setEditing({ server })}
              onRetry={() => void reconnect({ environmentId, input: { id: server.id } })}
            />
          ))
        )}
        <button
          type="button"
          disabled={!allowed || snapshot === undefined}
          className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground disabled:cursor-default sm:px-4"
          onClick={() => setEditing({ server: null })}
        >
          <PlusIcon className="size-4 shrink-0" />
          <T>Add MCP server</T>
        </button>
      </SettingsSection>
      {editing ? (
        <ServerDialog
          environmentId={environmentId}
          server={editing.server}
          status={editing.server ? statusById.get(editing.server.id) : undefined}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? (
        <ImportDialog environmentId={environmentId} onClose={() => setImporting(false)} />
      ) : null}
    </>
  );
}

function ServerRow(props: {
  readonly server: McpCatalogServer;
  readonly status: McpCatalogServerStatus | undefined;
  readonly allowed: boolean;
  readonly error: string | undefined;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onEdit: () => void;
  readonly onRetry: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { server, status } = props;
  const state = status?.state;
  const failed = state === "error";
  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{server.name}</span>
          <Badge
            variant={
              state === "connected"
                ? "success"
                : failed
                  ? "error"
                  : state === "connecting"
                    ? "info"
                    : "quiet"
            }
          >
            {statusLabel(status, messages)}
          </Badge>
        </span>
      }
      description={
        <>
          <span className="block break-all">
            <code>{server.id}</code> · {transportSummary(server)}
          </span>
          {failed && status?.error ? (
            <span className="mt-1 block text-destructive-foreground">{status.error}</span>
          ) : null}
          {props.error ? (
            <span role="alert" className="mt-1 block text-destructive-foreground">
              {props.error}
            </span>
          ) : null}
        </>
      }
      control={
        <div className="flex items-center gap-2">
          {failed ? (
            <Button size="xs" variant="outline" disabled={!props.allowed} onClick={props.onRetry}>
              <T>Retry</T>
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" disabled={!props.allowed} onClick={props.onEdit}>
            <T context="verb">Edit</T>
          </Button>
          <Switch
            aria-label={gt("Use {name}", { name: server.name })}
            checked={server.enabled}
            disabled={!props.allowed}
            onCheckedChange={props.onEnabledChange}
          />
        </div>
      }
    />
  );
}

function VariablesEditor(props: {
  readonly label: string;
  readonly noun: "variable" | "header";
  readonly variables: ReadonlyArray<VariableDraft>;
  readonly disabled: boolean;
  readonly onChange: (variables: ReadonlyArray<VariableDraft>) => void;
}) {
  const gt = useGT();
  const isVariable = props.noun === "variable";
  const update = (key: string, patch: Partial<VariableDraft>) =>
    props.onChange(
      props.variables.map((variable) =>
        variable.key === key ? { ...variable, ...patch } : variable,
      ),
    );
  return (
    <div className="grid gap-2 px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{props.label}</span>
        <Button
          size="xs"
          variant="ghost"
          disabled={props.disabled}
          onClick={() =>
            props.onChange([
              ...props.variables,
              { key: variableKey(), name: "", value: "", secret: false, stored: false },
            ])
          }
        >
          <PlusIcon />
          {isVariable ? <T>Add variable</T> : <T>Add header</T>}
        </Button>
      </div>
      {props.variables.map((variable) => (
        <div key={variable.key} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2">
          <Input
            size="sm"
            aria-label={isVariable ? gt("variable name") : gt("header name")}
            placeholder="NAME"
            value={variable.name}
            disabled={props.disabled}
            onChange={(event) => update(variable.key, { name: event.target.value })}
          />
          <Input
            size="sm"
            aria-label={isVariable ? gt("variable value") : gt("header value")}
            type={variable.secret ? "password" : "text"}
            placeholder={
              variable.secret && variable.stored
                ? gt("Saved", { $context: "a stored secret value" })
                : gt("value", { $context: "placeholder for a variable or header value" })
            }
            value={variable.value}
            disabled={props.disabled}
            onChange={(event) => update(variable.key, { value: event.target.value })}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={variable.secret}
              disabled={props.disabled}
              onCheckedChange={(checked) =>
                update(variable.key, { secret: checked === true, stored: false })
              }
            />
            <T context="marks a value as secret">Secret</T>
          </label>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={
              variable.name
                ? gt("Remove {name}", { name: variable.name })
                : isVariable
                  ? gt("Remove variable")
                  : gt("Remove header")
            }
            disabled={props.disabled}
            onClick={() =>
              props.onChange(props.variables.filter((candidate) => candidate.key !== variable.key))
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ServerDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly server: McpCatalogServer | null;
  readonly status: McpCatalogServerStatus | undefined;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { environmentId, server } = props;
  const upsert = useAtomCommand(serverEnvironment.upsertMcpCatalogServer, {
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.removeMcpCatalogServer, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState<ServerDraft>(() => (server ? draftFor(server) : emptyDraft()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const formId = "mcp-catalog-server";
  const edit = (patch: Partial<ServerDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async () => {
    const built = serverFromDraft(draft, server?.enabled ?? true);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await upsert({
      environmentId,
      input: { ...(server ? { previousId: server.id } : {}), server: built.server },
    });
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      setError(failureMessage(result, gt("Could not save this server.")));
      return;
    }
    props.onClose();
  };

  const removeServer = async () => {
    if (!server) return;
    setBusy(true);
    const result = await remove({ environmentId, input: { id: server.id } });
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      setError(failureMessage(result, gt("Could not remove this server.")));
      return;
    }
    props.onClose();
  };

  const tools = props.status?.state === "connected" ? props.status.tools : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title={server ? gt("Edit {name}", { name: server.name }) : gt("Add MCP server")}
          description={gt(
            "It runs on this machine. Every agent here can use its tools, whichever account or provider it runs on.",
          )}
        />
        <WizardPanel>
          <form
            id={formId}
            className="grid gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <SettingsRow
              title={gt("Name")}
              control={
                <Input
                  aria-label={gt("Name")}
                  value={draft.name}
                  disabled={busy}
                  placeholder={gt("e.g. GitHub")}
                  onChange={(event) => edit({ name: event.target.value })}
                />
              }
            />
            <SettingsRow
              title={gt("Id")}
              description={gt("How agents name this server.")}
              control={
                <Input
                  aria-label={gt("Id")}
                  value={draft.id ?? (draft.name.trim() === "" ? "" : draftId(draft))}
                  disabled={busy}
                  placeholder={gt("e.g. github")}
                  onChange={(event) => edit({ id: event.target.value })}
                />
              }
            />
            <SettingsRow
              title={gt("Connection")}
              control={
                <ToggleGroup
                  aria-label={gt("Connection")}
                  variant="segmented"
                  value={[draft.type]}
                  disabled={busy}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "stdio" || value === "http") edit({ type: value });
                  }}
                >
                  <ToggleGroupItem value="stdio">
                    <T>Command</T>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="http">URL</ToggleGroupItem>
                </ToggleGroup>
              }
            />
            {draft.type === "stdio" ? (
              <>
                <SettingsRow
                  title={gt("Command")}
                  description={gt("With its arguments, as you would type it in a terminal.")}
                  control={
                    <Input
                      aria-label={gt("Command")}
                      value={draft.commandLine}
                      disabled={busy}
                      // oxlint-disable-next-line t3code/no-untranslated-copy -- an example shell command
                      placeholder="npx -y @modelcontextprotocol/server-github"
                      onChange={(event) => edit({ commandLine: event.target.value })}
                    />
                  }
                />
                <SettingsRow
                  title={gt("Folder")}
                  description={gt("Optional. Where the command starts.")}
                  control={
                    <Input
                      aria-label={gt("Folder")}
                      value={draft.cwd}
                      disabled={busy}
                      placeholder="~/"
                      onChange={(event) => edit({ cwd: event.target.value })}
                    />
                  }
                />
                <VariablesEditor
                  label={gt("Environment variables")}
                  noun="variable"
                  variables={draft.env}
                  disabled={busy}
                  onChange={(env) => edit({ env })}
                />
              </>
            ) : (
              <>
                <SettingsRow
                  title="URL"
                  description={gt("A streamable HTTP endpoint.")}
                  control={
                    <Input
                      aria-label="URL"
                      value={draft.url}
                      disabled={busy}
                      placeholder="https://example.com/mcp"
                      onChange={(event) => edit({ url: event.target.value })}
                    />
                  }
                />
                <VariablesEditor
                  label={gt("Headers")}
                  noun="header"
                  variables={draft.headers}
                  disabled={busy}
                  onChange={(headers) => edit({ headers })}
                />
              </>
            )}
            {tools.length > 0 ? (
              <SettingsRow
                title={gt("Tools")}
                description={tools.map((tool) => tool.name).join(", ")}
              />
            ) : null}
            {error ? (
              <p role="alert" className="px-3 text-sm text-destructive-foreground sm:px-4">
                {error}
              </p>
            ) : null}
          </form>
        </WizardPanel>
        <WizardFooter>
          {server ? (
            <Button
              variant="destructive-outline"
              disabled={busy}
              onClick={() => (confirmingRemove ? void removeServer() : setConfirmingRemove(true))}
            >
              {confirmingRemove ? gt("Remove for every agent") : gt("Remove")}
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={props.onClose}>
            <T>Cancel</T>
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? gt("Saving…") : gt("Save")}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function ImportDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { environmentId } = props;
  const readCandidates = useAtomCommand(serverEnvironment.mcpCatalogImportCandidates, {
    reportFailure: false,
  });
  const importServers = useAtomCommand(serverEnvironment.importMcpCatalogServers, {
    reportFailure: false,
  });
  const [candidates, setCandidates] = useState<ReadonlyArray<McpCatalogImportCandidate> | null>(
    null,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyOf = (candidate: McpCatalogImportCandidate) =>
    `${candidate.source}:${candidate.server.id}`;

  const loadCandidates = useEffectEvent((isOpen: () => boolean) => {
    void readCandidates({ environmentId, input: {} }).then((result) => {
      if (!isOpen()) return;
      if (AsyncResult.isSuccess(result)) {
        setCandidates(result.value);
        setSelected(new Set(result.value.filter((candidate) => !candidate.exists).map(keyOf)));
      } else if (AsyncResult.isFailure(result)) {
        setCandidates([]);
        setError(failureMessage(result, gt("Could not read the CLI config files.")));
      }
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the CLI config files on the environment's machine when the dialog opens
  useEffect(() => {
    let open = true;
    loadCandidates(() => open);
    return () => {
      open = false;
    };
  }, []);

  const run = async () => {
    if (!candidates) return;
    setBusy(true);
    setError(null);
    const items = candidates
      .filter((candidate) => selected.has(keyOf(candidate)))
      .map((candidate) => ({ source: candidate.source, id: candidate.server.id }));
    const result = await importServers({ environmentId, input: { items } });
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      setError(failureMessage(result, gt("Could not import these servers.")));
      return;
    }
    props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title={gt("Import MCP servers")}
          description={gt(
            "From the config files of Claude Code, the Claude app, Codex, and Cursor on this machine, including your other Claude and Codex accounts. Secrets stay on this machine.",
          )}
        />
        <WizardPanel>
          {candidates === null ? (
            <SettingsRow title={gt("Reading config files…")} />
          ) : candidates.length === 0 ? (
            <SettingsRow
              title={gt("Nothing to import")}
              description={gt("None of those config files lists an MCP server.")}
            />
          ) : (
            candidates.map((candidate) => {
              const key = keyOf(candidate);
              return (
                <SettingsRow
                  key={key}
                  title={candidate.server.name}
                  description={
                    <span className="block break-all">
                      {IMPORT_SOURCE_LABELS[candidate.source]} ·{" "}
                      {transportSummary(candidate.server)}
                      {candidate.exists ? ` · ${gt("Already added")}` : ""}
                    </span>
                  }
                  control={
                    <Checkbox
                      aria-label={gt("Import {name}", { name: candidate.server.name })}
                      checked={selected.has(key)}
                      disabled={candidate.exists || busy}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                    />
                  }
                />
              );
            })
          )}
          {error ? (
            <p role="alert" className="px-3 text-sm text-destructive-foreground sm:px-4">
              {error}
            </p>
          ) : null}
        </WizardPanel>
        <WizardFooter>
          <Button variant="outline" disabled={busy} onClick={props.onClose}>
            <T>Cancel</T>
          </Button>
          <Button disabled={busy || selected.size === 0} onClick={() => void run()}>
            {busy
              ? gt("Importing…")
              : selected.size === 0
                ? gt("Import", { $context: "verb, imports the selected servers" })
                : gt("{count, plural, =1 {Import 1 server} other {Import {count} servers}}", {
                    count: selected.size,
                  })}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
