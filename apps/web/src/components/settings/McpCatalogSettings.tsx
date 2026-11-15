import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  McpCatalogImportCandidate,
  McpCatalogServer,
  McpCatalogServerStatus,
} from "@t3tools/contracts";
import { MCP_CATALOG_OAUTH_CALLBACK_PATH } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
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
import { searchableSetting } from "./settingsSearch";

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
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment ? (
        <McpCatalogSection environmentId={environment.environmentId} />
      ) : (
        <SettingsSection {...searchableSetting("mcp-servers")}>
          <SettingsRow
            title="Choose one environment"
            description="MCP servers belong to a single machine. Choose one above."
          />
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function McpCatalogSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(serverEnvironment.mcpCatalog({ environmentId, input: {} }));
  const allowed = useAtomValue(
    serverEnvironment.upsertMcpCatalogServer.permissionAtom(environmentId),
  );
  const upsert = useAtomCommand(serverEnvironment.upsertMcpCatalogServer, {
    reportFailure: false,
  });
  const startSignIn = useAtomCommand(serverEnvironment.startMcpCatalogOAuth, {
    reportFailure: false,
  });
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const reconnect = useAtomCommand(serverEnvironment.reconnectMcpCatalogServer, {
    reportFailure: false,
  });
  const [editing, setEditing] = useState<{ readonly server: McpCatalogServer | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [rowError, setRowError] = useState<{ readonly id: string; readonly message: string }>();
  const snapshot = query.data ?? undefined;
  const statusById = new Map(snapshot?.statuses.map((status) => [status.id, status]));

  const signIn = async (server: McpCatalogServer) => {
    setRowError(undefined);
    if (httpBaseUrl === null) {
      setRowError({ id: server.id, message: "Connect to this environment to sign in." });
      return;
    }
    // A tab opened inside the click survives popup blockers; the desktop app opens the browser.
    const tab = window.desktopBridge ? null : window.open("", "_blank");
    const result = await startSignIn({
      environmentId,
      input: {
        id: server.id,
        redirectUri: new URL(MCP_CATALOG_OAUTH_CALLBACK_PATH, httpBaseUrl).href,
      },
    });
    if (!AsyncResult.isSuccess(result)) {
      tab?.close();
      if (AsyncResult.isFailure(result)) {
        setRowError({
          id: server.id,
          message: failureMessage(result, "Could not start the sign-in."),
        });
      }
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.value.authorizationUrl;
    } else {
      void ensureLocalApi().shell.openExternal(result.value.authorizationUrl);
    }
  };

  const setEnabled = async (server: McpCatalogServer, enabled: boolean) => {
    setRowError(undefined);
    const result = await upsert({
      environmentId,
      input: { previousId: server.id, server: { ...server, enabled } },
    });
    if (AsyncResult.isFailure(result)) {
      setRowError({
        id: server.id,
        message: failureMessage(result, "Could not save this change."),
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
            Import
          </Button>
        }
      >
        {snapshot === undefined ? (
          <SettingsRow
            title={query.error ? "MCP servers are unavailable" : "Loading…"}
            description={query.error ?? undefined}
          />
        ) : snapshot.servers.length === 0 ? (
          <SettingsRow
            title="No servers yet"
            description="Add one, or import the ones Claude, Codex, and Cursor already use. Every agent here, on any account, then reaches them through T3 Code without its own copy."
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
              onSignIn={() => void signIn(server)}
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
          Add MCP server
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
  readonly onSignIn: () => void;
}) {
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
            {statusLabel(status)}
          </Badge>
        </span>
      }
      description={
        <>
          <span className="block break-all">
            <code>{server.id}</code> · {transportSummary(server)}
          </span>
          {failed && status?.error && status.auth !== "required" ? (
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
          {status?.auth === "required" ? (
            <Button size="xs" variant="outline" disabled={!props.allowed} onClick={props.onSignIn}>
              Sign in
            </Button>
          ) : failed ? (
            <Button size="xs" variant="outline" disabled={!props.allowed} onClick={props.onRetry}>
              Retry
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" disabled={!props.allowed} onClick={props.onEdit}>
            Edit
          </Button>
          <Switch
            aria-label={`Use ${server.name}`}
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
  readonly noun: string;
  readonly variables: ReadonlyArray<VariableDraft>;
  readonly disabled: boolean;
  readonly onChange: (variables: ReadonlyArray<VariableDraft>) => void;
}) {
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
          Add {props.noun}
        </Button>
      </div>
      {props.variables.map((variable) => (
        <div key={variable.key} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2">
          <Input
            size="sm"
            aria-label={`${props.noun} name`}
            placeholder="NAME"
            value={variable.name}
            disabled={props.disabled}
            onChange={(event) => update(variable.key, { name: event.target.value })}
          />
          <Input
            size="sm"
            aria-label={`${props.noun} value`}
            type={variable.secret ? "password" : "text"}
            placeholder={variable.secret && variable.stored ? "Saved" : "value"}
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
            Secret
          </label>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Remove ${variable.name || props.noun}`}
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
  const { environmentId, server } = props;
  const upsert = useAtomCommand(serverEnvironment.upsertMcpCatalogServer, {
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.removeMcpCatalogServer, {
    reportFailure: false,
  });
  const signOut = useAtomCommand(serverEnvironment.signOutMcpCatalogServer, {
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
      setError(failureMessage(result, "Could not save this server."));
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
      setError(failureMessage(result, "Could not remove this server."));
      return;
    }
    props.onClose();
  };

  const signOutServer = async () => {
    if (!server) return;
    setBusy(true);
    const result = await signOut({ environmentId, input: { id: server.id } });
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      setError(failureMessage(result, "Could not sign out."));
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
          title={server ? `Edit ${server.name}` : "Add MCP server"}
          description="It runs on this machine. Every agent here can use its tools, whichever account or provider it runs on."
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
              title="Name"
              control={
                <Input
                  aria-label="Name"
                  value={draft.name}
                  disabled={busy}
                  placeholder="e.g. GitHub"
                  onChange={(event) => edit({ name: event.target.value })}
                />
              }
            />
            <SettingsRow
              title="Id"
              description="How agents name this server."
              control={
                <Input
                  aria-label="Id"
                  value={draft.id ?? (draft.name.trim() === "" ? "" : draftId(draft))}
                  disabled={busy}
                  placeholder="e.g. github"
                  onChange={(event) => edit({ id: event.target.value })}
                />
              }
            />
            <SettingsRow
              title="Connection"
              control={
                <ToggleGroup
                  aria-label="Connection"
                  variant="segmented"
                  value={[draft.type]}
                  disabled={busy}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "stdio" || value === "http") edit({ type: value });
                  }}
                >
                  <ToggleGroupItem value="stdio">Command</ToggleGroupItem>
                  <ToggleGroupItem value="http">URL</ToggleGroupItem>
                </ToggleGroup>
              }
            />
            {draft.type === "stdio" ? (
              <>
                <SettingsRow
                  title="Command"
                  description="With its arguments, as you would type it in a terminal."
                  control={
                    <Input
                      aria-label="Command"
                      value={draft.commandLine}
                      disabled={busy}
                      placeholder="npx -y @modelcontextprotocol/server-github"
                      onChange={(event) => edit({ commandLine: event.target.value })}
                    />
                  }
                />
                <SettingsRow
                  title="Folder"
                  description="Optional. Where the command starts."
                  control={
                    <Input
                      aria-label="Folder"
                      value={draft.cwd}
                      disabled={busy}
                      placeholder="~/"
                      onChange={(event) => edit({ cwd: event.target.value })}
                    />
                  }
                />
                <VariablesEditor
                  label="Environment variables"
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
                  description="A streamable HTTP endpoint. If it needs a sign-in, the list shows Sign in."
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
                  label="Headers"
                  noun="header"
                  variables={draft.headers}
                  disabled={busy}
                  onChange={(headers) => edit({ headers })}
                />
                {props.status?.auth === "signed-in" ? (
                  <SettingsRow
                    title="Signed in"
                    description="Through the browser. Every agent here uses this sign-in."
                    control={
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void signOutServer()}
                      >
                        Sign out
                      </Button>
                    }
                  />
                ) : null}
              </>
            )}
            {tools.length > 0 ? (
              <SettingsRow title="Tools" description={tools.map((tool) => tool.name).join(", ")} />
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
              {confirmingRemove ? "Remove for every agent" : "Remove"}
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Saving…" : "Save"}
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
        setError(failureMessage(result, "Could not read the CLI config files."));
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
      setError(failureMessage(result, "Could not import these servers."));
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
          title="Import MCP servers"
          description="From the config files of Claude Code, the Claude app, Codex, and Cursor on this machine, including your other Claude and Codex accounts. Secrets stay on this machine."
        />
        <WizardPanel>
          {candidates === null ? (
            <SettingsRow title="Reading config files…" />
          ) : candidates.length === 0 ? (
            <SettingsRow
              title="Nothing to import"
              description="None of those config files lists an MCP server."
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
                      {candidate.exists ? " · Already added" : ""}
                    </span>
                  }
                  control={
                    <Checkbox
                      aria-label={`Import ${candidate.server.name}`}
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
            Cancel
          </Button>
          <Button disabled={busy || selected.size === 0} onClick={() => void run()}>
            {busy
              ? "Importing…"
              : selected.size === 0
                ? "Import"
                : selected.size === 1
                  ? "Import 1 server"
                  : `Import ${selected.size} servers`}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
