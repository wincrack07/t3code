import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_PR_REVIEW_COMMAND,
  type EnvironmentId,
  type ModelSelection,
  type PrReviewConfig,
  type PrReviewRecord,
  type ProjectId,
  PR_REVIEW_EXECUTION_SHIPPED,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { PlusIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

/** The provider a rule matches, by driver kind, as T3 detects it on the pull request. */
const AUTHOR_PROVIDERS = [
  ["codex", "Codex"],
  ["claudeAgent", "Claude"],
  ["cursor", "Cursor"],
  ["grok", "Grok"],
  ["opencode", "OpenCode"],
  ["antigravity", "Antigravity"],
  ["kiro", "Kiro"],
  ["unknown", "Unknown author"],
  ["any", "Any author"],
] as const;

const EFFORTS = ["default", "low", "medium", "high", "xhigh"] as const;

// Claude and Codex name their effort option differently; other providers keep their default.
const effortOptionId = (instanceId: string) =>
  instanceId.startsWith("claude")
    ? "effort"
    : instanceId.startsWith("codex")
      ? "reasoningEffort"
      : null;

const effortOf = (selection: ModelSelection): string => {
  const value = selection.options?.find(
    (option) => option.id === "effort" || option.id === "reasoningEffort",
  )?.value;
  return typeof value === "string" ? value : "default";
};

function withEffort(selection: ModelSelection, effort: string): ModelSelection {
  const id = effortOptionId(selection.instanceId);
  const others = (selection.options ?? []).filter(
    (option) => option.id !== "effort" && option.id !== "reasoningEffort",
  );
  const options = id === null || effort === "default" ? others : [...others, { id, value: effort }];
  return {
    instanceId: selection.instanceId,
    model: selection.model,
    ...(options.length > 0 ? { options } : {}),
  };
}

const STATUS_VARIANT: Record<PrReviewRecord["status"], "default" | "outline" | "destructive"> = {
  waiting: "outline",
  running: "outline",
  posted: "default",
  failed: "destructive",
  skipped: "outline",
  "lost-claim": "outline",
};

const APP_MANIFEST = JSON.stringify(
  {
    name: "t3-review",
    url: "https://t3.codes",
    hook_attributes: { url: "https://example.invalid/webhook", active: false },
    public: false,
    default_permissions: {
      contents: "read",
      pull_requests: "write",
      issues: "write",
      metadata: "read",
    },
    default_events: [],
  },
  null,
  2,
);

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: String(squashAtomCommandFailure(result)),
    }),
  );
}

function ReviewerPicker({
  environmentId,
  projectId,
  value,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly value: ModelSelection | null;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, projectId);
  const instanceId =
    value?.instanceId ?? instanceEntries[0]?.instanceId ?? ProviderInstanceId.make("codex");
  const model = value?.model ?? "";
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    instanceId,
    model,
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProviderModelPicker
        environmentId={environmentId}
        disabled={false}
        activeInstanceId={instanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={instanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        isComposerOwned={false}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        onInstanceModelChange={(nextInstance, nextModel) =>
          onChange(
            withEffort(
              { instanceId: nextInstance, model: nextModel },
              value ? effortOf(value) : "default",
            ),
          )
        }
      />
      {value !== null && effortOptionId(value.instanceId) !== null ? (
        <Select
          value={effortOf(value)}
          onValueChange={(effort) => effort && onChange(withEffort(value, effort))}
        >
          <SelectTrigger aria-label="Effort" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {EFFORTS.map((effort) => (
              <SelectItem key={effort} value={effort}>
                {effort === "default" ? "Default effort" : effort}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
    </div>
  );
}

function HistoryRow({
  environmentId,
  record,
  canOperate,
}: {
  readonly environmentId: EnvironmentId;
  readonly record: PrReviewRecord;
  readonly canOperate: boolean;
}) {
  const rerun = useAtomCommand(serverEnvironment.rerunPrReview, {
    label: "PR review re-run",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  return (
    <SettingsRow
      title={`${record.repository}#${record.number} · ${record.headSha.slice(0, 7)}`}
      description={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>
            {record.trigger}
            {record.requestedBy ? ` by ${record.requestedBy}` : ""} ·{" "}
            {record.reviewer?.model ?? "no model"} · author {record.authorProvider} ·{" "}
            {formatRelativeTimeLabel(record.updatedAt)}
          </span>
          {record.threadId ? (
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(environmentId, record.threadId))}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Thread
            </Link>
          ) : null}
          {record.reviewUrl ? (
            <a
              href={record.reviewUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              GitHub review
            </a>
          ) : null}
          {record.detail ? <span className="text-destructive">{record.detail}</span> : null}
        </span>
      }
      control={
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[record.status]}>{record.status}</Badge>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!canOperate || busy}
            onClick={async () => {
              setBusy(true);
              const result = await rerun({ environmentId, input: { recordId: record.id } });
              setBusy(false);
              if (result._tag === "Failure") reportFailure("Could not re-run the review", result);
            }}
          >
            <RotateCwIcon className="size-3" />
            Re-run
          </Button>
        </div>
      }
    />
  );
}

export function PrReviewsSettings() {
  const { connectedEnvironments, environment } = useSettingsScope();
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const environmentId =
    selectedId ?? environment?.environmentId ?? connectedEnvironments[0]?.environmentId ?? null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.prReviewState({ environmentId, input: {} }),
  );
  const canWrite = useAtomValue(
    serverEnvironment.updatePrReviewConfig.permissionAtom(environmentId ?? ("" as EnvironmentId)),
  );
  const canOperate = useAtomValue(
    serverEnvironment.rerunPrReview.permissionAtom(environmentId ?? ("" as EnvironmentId)),
  );
  const updateConfig = useAtomCommand(serverEnvironment.updatePrReviewConfig, {
    label: "PR review settings",
    reportFailure: false,
  });
  const setPrivateKey = useAtomCommand(serverEnvironment.setPrReviewPrivateKey, {
    label: "PR review private key",
    reportFailure: false,
  });
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [draft, setDraft] = useState<{
    readonly environmentId: EnvironmentId;
    readonly config: PrReviewConfig;
  } | null>(null);
  const [privateKey, setPrivateKeyText] = useState("");
  const [saving, setSaving] = useState(false);
  const state = query.data;
  // The draft belongs to one environment; switching starts again from its saved settings.
  const config =
    draft !== null && draft.environmentId === environmentId
      ? draft.config
      : (state?.config ?? null);
  const edit = (patch: Partial<PrReviewConfig>) => {
    if (config === null || environmentId === null) return;
    setDraft({ environmentId, config: { ...config, ...patch } });
  };
  const dirty = draft !== null && draft.environmentId === environmentId;

  const save = async () => {
    if (config === null || environmentId === null) return;
    setSaving(true);
    const result = await updateConfig({ environmentId, input: config });
    setSaving(false);
    if (result._tag === "Failure") reportFailure("Could not save PR review settings", result);
    else {
      setDraft(null);
      query.refresh();
    }
  };
  const saveKey = async () => {
    if (environmentId === null) return;
    const result = await setPrivateKey({ environmentId, input: { privateKey } });
    if (result._tag === "Failure") reportFailure("Could not store the private key", result);
    else {
      setPrivateKeyText("");
      query.refresh();
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="PR reviews"
        variant="plain"
        headerAction={
          <Button size="xs" disabled={!dirty || saving || !canWrite} onClick={save}>
            Save
          </Button>
        }
      >
        <SettingsSection title="Reviewer environment">
          {connectedEnvironments.length > 1 ? (
            <SettingsRow
              title="Environment"
              description="Each environment keeps its own PR review settings."
              control={
                <Select
                  value={environmentId ?? ""}
                  onValueChange={(value) => value && setSelectedId(value as EnvironmentId)}
                >
                  <SelectTrigger size="sm" aria-label="Environment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {connectedEnvironments.map((entry) => (
                      <SelectItem key={entry.environmentId} value={entry.environmentId}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
          ) : null}
          {config === null ? (
            <SettingsRow title={query.error ?? "Loading…"} />
          ) : (
            <>
              {PR_REVIEW_EXECUTION_SHIPPED ? (
                <SettingsRow
                  title="Review pull requests from this environment"
                  description="Only designated environments poll GitHub. With several, the lowest priority number reviews; the others wait one grace period per step and take over only if it does not claim the pull request."
                  control={
                    <Switch
                      checked={config.enabled}
                      disabled={!canWrite}
                      onCheckedChange={(enabled) => edit({ enabled })}
                    />
                  }
                />
              ) : (
                <SettingsRow
                  title="Reviews are not running yet"
                  description="Prepare the identity, repositories and rules now. A later update turns reviews on."
                />
              )}
              <SettingsRow
                title="Priority"
                description="0 is the primary reviewer, 1 the first fallback, and so on."
                control={
                  <Input
                    className="w-20"
                    type="number"
                    min={0}
                    value={config.priority}
                    disabled={!canWrite}
                    onChange={(event) =>
                      edit({ priority: Math.max(0, Math.floor(Number(event.target.value) || 0)) })
                    }
                  />
                }
              />
              <SettingsRow
                title="Claim grace"
                description="Seconds each priority step waits."
                control={
                  <Input
                    className="w-20"
                    type="number"
                    min={0}
                    value={config.claimGraceSeconds}
                    disabled={!canWrite}
                    onChange={(event) =>
                      edit({
                        claimGraceSeconds: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                      })
                    }
                  />
                }
              />
            </>
          )}
        </SettingsSection>

        {config !== null && state && environmentId !== null ? (
          <>
            <SettingsSection title="GitHub identity">
              <SettingsRow
                title="Post reviews as"
                description={state.identity.detail}
                status={
                  <Badge variant={state.identity.ready ? "default" : "outline"}>
                    {state.identity.ready ? "Ready" : "Not ready"}
                  </Badge>
                }
                control={
                  <Select
                    value={config.identity.mode}
                    onValueChange={(mode) =>
                      (mode === "gh" || mode === "github-app") &&
                      edit({ identity: { ...config.identity, mode } })
                    }
                  >
                    <SelectTrigger size="sm" aria-label="Identity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="github-app">GitHub App (bot account)</SelectItem>
                      <SelectItem value="gh">This environment's gh login</SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
              {config.identity.mode === "github-app" ? (
                <>
                  <SettingsRow
                    title="Create the App"
                    description="Reviews then come from the App's own bot account. It needs no webhook and only the permissions below."
                  >
                    <div className="space-y-2 px-3 pb-3 text-xs text-muted-foreground sm:px-4">
                      <ol className="list-decimal space-y-1 pl-4">
                        <li>
                          Create it with the button, or by hand under GitHub Settings → Developer
                          settings → GitHub Apps with Webhook off and these repository permissions:
                          Pull requests read and write, Issues read and write, Contents read.
                        </li>
                        <li>Copy the App ID and generate a private key on the App's page.</li>
                        <li>
                          Install the App on the repositories to review; the installation ID is the
                          number at the end of the installation page's URL.
                        </li>
                      </ol>
                      <form
                        method="post"
                        action="https://github.com/settings/apps/new"
                        target="_blank"
                      >
                        <input type="hidden" name="manifest" value={APP_MANIFEST} />
                        <Button size="xs" variant="outline" type="submit">
                          Create the App on GitHub
                        </Button>
                      </form>
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    title="App ID"
                    control={
                      <Input
                        className="w-48"
                        value={config.identity.appId}
                        disabled={!canWrite}
                        onChange={(event) =>
                          edit({ identity: { ...config.identity, appId: event.target.value } })
                        }
                      />
                    }
                  />
                  <SettingsRow
                    title="Installation ID"
                    control={
                      <Input
                        className="w-48"
                        value={config.identity.installationId}
                        disabled={!canWrite}
                        onChange={(event) =>
                          edit({
                            identity: { ...config.identity, installationId: event.target.value },
                          })
                        }
                      />
                    }
                  />
                  <SettingsRow
                    title="App name (slug)"
                    description="Optional; read from GitHub when empty."
                    control={
                      <Input
                        className="w-48"
                        value={config.identity.appSlug}
                        disabled={!canWrite}
                        onChange={(event) =>
                          edit({ identity: { ...config.identity, appSlug: event.target.value } })
                        }
                      />
                    }
                  />
                  <SettingsRow
                    title="Private key"
                    description={
                      state.identity.hasPrivateKey
                        ? "Stored in this environment's secret store. Paste a new key to replace it, or save empty to remove it."
                        : "Paste the .pem file's contents. It is stored in this environment's secret store and never sent back."
                    }
                  >
                    <div className="flex flex-col gap-2 px-3 pb-3 sm:px-4">
                      <Textarea
                        value={privateKey}
                        placeholder="-----BEGIN RSA PRIVATE KEY-----"
                        disabled={!canWrite}
                        onChange={(event) => setPrivateKeyText(event.target.value)}
                      />
                      <div>
                        <Button size="xs" variant="outline" disabled={!canWrite} onClick={saveKey}>
                          {privateKey.trim() === "" && state.identity.hasPrivateKey
                            ? "Remove key"
                            : "Store key"}
                        </Button>
                      </div>
                    </div>
                  </SettingsRow>
                </>
              ) : null}
            </SettingsSection>

            <SettingsSection title="Triggers">
              <SettingsRow
                title="Command"
                description="A pull request comment containing this asks for a review; text after it is the reviewer's focus. Replying to one of the bot's comments with it asks the review thread a question."
                control={
                  <Input
                    className="w-48"
                    placeholder={DEFAULT_PR_REVIEW_COMMAND}
                    value={config.command}
                    disabled={!canWrite}
                    onChange={(event) => edit({ command: event.target.value })}
                  />
                }
              />
              <SettingsRow
                title="Review when requested as a reviewer"
                description="GitHub App identity only: requesting the bot reviews the current head."
                control={
                  <Switch
                    checked={config.reviewOnRequest}
                    disabled={!canWrite}
                    onCheckedChange={(reviewOnRequest) => edit({ reviewOnRequest })}
                  />
                }
              />
              <SettingsRow
                title="Allowed users"
                description="Comma-separated GitHub logins. Empty allows repository collaborators with write access."
                control={
                  <Input
                    className="w-64"
                    value={config.allowedLogins.join(", ")}
                    disabled={!canWrite}
                    onChange={(event) =>
                      edit({
                        allowedLogins: event.target.value
                          .split(",")
                          .map((login) => login.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                }
              />
            </SettingsSection>

            <SettingsSection
              title="Repositories"
              headerAction={
                <Button
                  size="xs"
                  variant="ghost-muted"
                  disabled={!canWrite || projects.length === 0}
                  onClick={() =>
                    edit({
                      repositories: [
                        ...config.repositories,
                        {
                          repository: "",
                          projectId: projects[0]!.id,
                          enabled: true,
                          autoReview: false,
                          instructions: "",
                        },
                      ],
                    })
                  }
                >
                  <PlusIcon className="size-3" />
                  Add
                </Button>
              }
            >
              {config.repositories.length === 0 ? (
                <SettingsRow
                  title="No repositories"
                  description="Add the owner/name of a GitHub repository and the project that holds its checkout."
                />
              ) : null}
              {config.repositories.map((repo, index) => {
                const replace = (patch: Partial<typeof repo>) =>
                  edit({
                    repositories: config.repositories.map((entry, at) =>
                      at === index ? { ...entry, ...patch } : entry,
                    ),
                  });
                return (
                  <SettingsRow
                    key={`${repo.projectId}:${repo.repository}`}
                    title={
                      <Input
                        className="w-56"
                        placeholder="owner/name"
                        aria-label="Repository"
                        value={repo.repository}
                        disabled={!canWrite}
                        onChange={(event) => replace({ repository: event.target.value.trim() })}
                      />
                    }
                    control={
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={repo.projectId}
                          onValueChange={(projectId) =>
                            projectId && replace({ projectId: projectId as ProjectId })
                          }
                        >
                          <SelectTrigger size="sm" aria-label="Project">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.title}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                        <span className="text-xs text-muted-foreground">Auto-review</span>
                        <Switch
                          checked={repo.autoReview}
                          disabled={!canWrite}
                          onCheckedChange={(autoReview) => replace({ autoReview })}
                        />
                        <span className="text-xs text-muted-foreground">On</span>
                        <Switch
                          checked={repo.enabled}
                          disabled={!canWrite}
                          onCheckedChange={(enabled) => replace({ enabled })}
                        />
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label="Remove repository"
                          disabled={!canWrite}
                          onClick={() =>
                            edit({
                              repositories: config.repositories.filter(
                                (_entry, at) => at !== index,
                              ),
                            })
                          }
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      </div>
                    }
                  >
                    <div className="px-3 pb-3 sm:px-4">
                      <Textarea
                        placeholder="Review instructions for this repository (replaces the default below)"
                        value={repo.instructions}
                        disabled={!canWrite}
                        onChange={(event) => replace({ instructions: event.target.value })}
                      />
                    </div>
                  </SettingsRow>
                );
              })}
            </SettingsSection>

            <SettingsSection
              title="Reviewer rules"
              headerAction={
                <Button
                  size="xs"
                  variant="ghost-muted"
                  disabled={!canWrite}
                  onClick={() =>
                    edit({
                      rules: [
                        ...config.rules,
                        {
                          authorProvider:
                            AUTHOR_PROVIDERS.map(([value]) => value).find(
                              (value) =>
                                !config.rules.some((rule) => rule.authorProvider === value),
                            ) ?? "any",
                          reviewer: config.defaultReviewer ?? {
                            instanceId: ProviderInstanceId.make("claudeAgent"),
                            model: "claude-opus-5-5",
                          },
                        },
                      ],
                    })
                  }
                >
                  <PlusIcon className="size-3" />
                  Add rule
                </Button>
              }
            >
              <SettingsRow
                title="How the author is found"
                description="From the T3 thread that created or pushed the PR, else its commits' Co-Authored-By trailers. The first matching rule picks the reviewer."
              />
              {config.rules.map((rule, index) => (
                <SettingsRow
                  key={`${rule.authorProvider}:${rule.reviewer.instanceId}:${rule.reviewer.model}`}
                  title={
                    <span className="flex items-center gap-2">
                      If written by
                      <Select
                        value={rule.authorProvider}
                        onValueChange={(authorProvider) =>
                          authorProvider &&
                          edit({
                            rules: config.rules.map((entry, at) =>
                              at === index ? { ...entry, authorProvider } : entry,
                            ),
                          })
                        }
                      >
                        <SelectTrigger size="sm" aria-label="Author provider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          {AUTHOR_PROVIDERS.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      review with
                    </span>
                  }
                  control={
                    <div className="flex items-center gap-2">
                      <ReviewerPicker
                        environmentId={environmentId}
                        projectId={null}
                        value={rule.reviewer}
                        onChange={(reviewer) =>
                          edit({
                            rules: config.rules.map((entry, at) =>
                              at === index ? { ...entry, reviewer } : entry,
                            ),
                          })
                        }
                      />
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label="Remove rule"
                        disabled={!canWrite}
                        onClick={() =>
                          edit({ rules: config.rules.filter((_entry, at) => at !== index) })
                        }
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  }
                />
              ))}
              <SettingsRow
                title="Otherwise"
                description="Used when no rule matches. Unset uses the environment's default model."
                control={
                  <ReviewerPicker
                    environmentId={environmentId}
                    projectId={null}
                    value={config.defaultReviewer}
                    onChange={(defaultReviewer) => edit({ defaultReviewer })}
                  />
                }
              />
            </SettingsSection>

            <SettingsSection title="Review instructions">
              <SettingsRow
                title="Default instructions"
                description="Empty uses T3's: verified defects only, no style nits."
              >
                <div className="px-3 pb-3 sm:px-4">
                  <Textarea
                    value={config.instructions}
                    disabled={!canWrite}
                    onChange={(event) => edit({ instructions: event.target.value })}
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            {PR_REVIEW_EXECUTION_SHIPPED ? (
              <SettingsSection title="History">
                <SettingsRow
                  title="Polling"
                  description={
                    state.polling.lastError
                      ? `Last poll failed: ${state.polling.lastError}`
                      : state.polling.lastPollAt
                        ? `Last polled ${formatRelativeTimeLabel(state.polling.lastPollAt)}.`
                        : config.enabled
                          ? "Waiting for the first poll."
                          : "Off on this environment."
                  }
                />
                {state.history.length === 0 ? <SettingsRow title="No reviews yet" /> : null}
                {state.history.map((record) => (
                  <HistoryRow
                    key={record.id}
                    environmentId={environmentId}
                    record={record}
                    canOperate={canOperate}
                  />
                ))}
              </SettingsSection>
            ) : null}
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
