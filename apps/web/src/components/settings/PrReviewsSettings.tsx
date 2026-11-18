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
  ProviderInstanceId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
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
  ["unknown", msg("Unknown author")],
  ["any", msg("Any author")],
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
  const gt = useGT();
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
    <div className="flex flex-wrap items-center justify-end gap-2">
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
          <SelectTrigger
            aria-label={gt("Effort", { $context: "reasoning effort picker" })}
            size="sm"
            className="w-full sm:w-36"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {EFFORTS.map((effort) => (
              <SelectItem hideIndicator key={effort} value={effort}>
                {effort === "default" ? gt("Default effort") : effort}
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
  const gt = useGT();
  const m = useMessages();
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
            {record.requestedBy
              ? gt("{trigger} by {requestedBy}", {
                  trigger: record.trigger,
                  requestedBy: record.requestedBy,
                })
              : record.trigger}{" "}
            · {record.reviewer?.model ?? gt("no model")} ·{" "}
            {gt("author {provider}", { provider: record.authorProvider })} ·{" "}
            {formatRelativeTimeLabel(record.updatedAt, undefined, m)}
          </span>
          {record.threadId ? (
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(environmentId, record.threadId))}
              className="underline underline-offset-2 hover:text-foreground"
            >
              <T context="link to the review's thread">Thread</T>
            </Link>
          ) : null}
          {record.reviewUrl ? (
            <a
              href={record.reviewUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              <T>GitHub review</T>
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
              if (result._tag === "Failure")
                reportFailure(gt("Could not re-run the review"), result);
            }}
          >
            <RotateCwIcon className="size-3" />
            <T context="verb, run the review again">Re-run</T>
          </Button>
        </div>
      }
    />
  );
}

function RepositoryRow({
  repo,
  projects,
  canWrite,
  onChange,
  onRemove,
}: {
  readonly repo: PrReviewConfig["repositories"][number];
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly canWrite: boolean;
  readonly onChange: (patch: Partial<PrReviewConfig["repositories"][number]>) => void;
  readonly onRemove: () => void;
}) {
  const gt = useGT();
  return (
    <SettingsRow
      title={repo.repository || gt("New repository")}
      control={
        <div className="flex items-center gap-2">
          <Switch
            checked={repo.enabled}
            disabled={!canWrite}
            onCheckedChange={(enabled) => onChange({ enabled })}
            aria-label={
              repo.repository
                ? gt("Review {repository}", { repository: repo.repository })
                : gt("Review this repository")
            }
          />
          <Button
            size="icon-sm"
            variant="ghost-destructive"
            aria-label={gt("Remove repository")}
            disabled={!canWrite}
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        </div>
      }
    >
      <div className="mt-3 flex min-w-0 max-w-2xl flex-col gap-3 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              size="sm"
              font="mono"
              placeholder="owner/name"
              aria-label={gt("Repository")}
              value={repo.repository}
              disabled={!canWrite}
              onChange={(event) => onChange({ repository: event.target.value.trim() })}
            />
          </div>
          <Select
            value={repo.projectId}
            onValueChange={(projectId) =>
              projectId && onChange({ projectId: projectId as ProjectId })
            }
          >
            <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Project")}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {projects.map((project) => (
                <SelectItem hideIndicator key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            size="sm"
            checked={repo.autoReview}
            disabled={!canWrite}
            onCheckedChange={(autoReview) => onChange({ autoReview })}
          />
          <T>Review new pull requests automatically</T>
        </label>
        <Textarea
          size="sm"
          aria-label={gt("Repository review instructions")}
          placeholder={gt("Instructions for this repository. Replaces the default instructions.")}
          value={repo.instructions}
          disabled={!canWrite}
          onChange={(event) => onChange({ instructions: event.target.value })}
        />
      </div>
    </SettingsRow>
  );
}

export function PrReviewsSettings() {
  const gt = useGT();
  const m = useMessages();
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
    if (result._tag === "Failure") reportFailure(gt("Could not save PR review settings"), result);
    else {
      setDraft(null);
      query.refresh();
    }
  };
  const saveKey = async () => {
    if (environmentId === null) return;
    const result = await setPrivateKey({ environmentId, input: { privateKey } });
    if (result._tag === "Failure") reportFailure(gt("Could not store the private key"), result);
    else {
      setPrivateKeyText("");
      query.refresh();
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="pr-reviews"
        title={gt("Reviewer", { $context: "settings section for the pull request reviewer" })}
      >
        {connectedEnvironments.length > 1 ? (
          <SettingsRow
            title={gt("Environment")}
            description={gt("Each environment keeps its own PR review settings.")}
            control={
              <Select
                value={environmentId ?? ""}
                onValueChange={(value) => value && setSelectedId(value as EnvironmentId)}
              >
                <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Environment")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {connectedEnvironments.map((entry) => (
                    <SelectItem hideIndicator key={entry.environmentId} value={entry.environmentId}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
        {config === null ? (
          <SettingsRow title={query.error ?? gt("Loading…")} />
        ) : (
          <>
            <SettingsRow
              title={gt("Review pull requests from this environment")}
              description={gt(
                "Only environments with this on poll GitHub. With several, the lowest priority number reviews and the others step in if it doesn't claim the pull request in time.",
              )}
              control={
                <Switch
                  checked={config.enabled}
                  disabled={!canWrite}
                  onCheckedChange={(enabled) => edit({ enabled })}
                  aria-label={gt("Review pull requests from this environment")}
                />
              }
            />
            <SettingsRow
              title={gt("Priority")}
              description={gt("0 is the main reviewer, 1 the first fallback, and so on.")}
              control={
                <Input
                  size="sm"
                  className="w-full sm:w-24"
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
              title={gt("Claim grace")}
              description={gt("Seconds each fallback waits before it steps in.")}
              control={
                <Input
                  size="sm"
                  className="w-full sm:w-24"
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
          <SettingsSection title={gt("GitHub identity")}>
            <SettingsRow
              title={gt("Post reviews as")}
              description={state.identity.detail}
              status={
                <Badge variant={state.identity.ready ? "default" : "outline"}>
                  {state.identity.ready
                    ? gt("Ready", { $context: "GitHub identity status" })
                    : gt("Not ready", { $context: "GitHub identity status" })}
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
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-56"
                    aria-label={gt("Identity", { $context: "GitHub account reviews post as" })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem hideIndicator value="github-app">
                      <T>GitHub App (bot account)</T>
                    </SelectItem>
                    <SelectItem hideIndicator value="gh">
                      <T>This environment's gh login</T>
                    </SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
            {config.identity.mode === "github-app" ? (
              <>
                <SettingsRow
                  title={gt("Create the App")}
                  description={gt(
                    "Reviews come from the App's own bot account. It needs no webhook.",
                  )}
                >
                  <div className="mt-3 flex max-w-2xl flex-col items-start gap-3 pb-3 text-xs leading-normal text-muted-foreground">
                    <ol className="list-decimal space-y-1 ps-4">
                      <li>
                        <T>
                          Create it with the button, or by hand under GitHub Settings → Developer
                          settings → GitHub Apps with Webhook off and these repository permissions:
                          Pull requests read and write, Issues read and write, Contents read.
                        </T>
                      </li>
                      <li>
                        <T>Copy the App ID and generate a private key on the App's page.</T>
                      </li>
                      <li>
                        <T>
                          Install the App on the repositories to review; the installation ID is the
                          number at the end of the installation page's URL.
                        </T>
                      </li>
                    </ol>
                    <form
                      method="post"
                      action="https://github.com/settings/apps/new"
                      target="_blank"
                    >
                      <input type="hidden" name="manifest" value={APP_MANIFEST} />
                      <Button size="sm" variant="outline" type="submit">
                        <T>Create the App on GitHub</T>
                      </Button>
                    </form>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title={gt("App ID")}
                  control={
                    <Input
                      size="sm"
                      className="w-full sm:w-48"
                      value={config.identity.appId}
                      disabled={!canWrite}
                      onChange={(event) =>
                        edit({ identity: { ...config.identity, appId: event.target.value } })
                      }
                    />
                  }
                />
                <SettingsRow
                  title={gt("Installation ID")}
                  control={
                    <Input
                      size="sm"
                      className="w-full sm:w-48"
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
                  title={gt("App slug")}
                  description={gt("Optional. Read from GitHub when empty.")}
                  control={
                    <Input
                      size="sm"
                      className="w-full sm:w-48"
                      value={config.identity.appSlug}
                      disabled={!canWrite}
                      onChange={(event) =>
                        edit({ identity: { ...config.identity, appSlug: event.target.value } })
                      }
                    />
                  }
                />
                <SettingsRow
                  title={gt("Private key")}
                  description={
                    state.identity.hasPrivateKey
                      ? gt(
                          "Saved in this environment's secret store. Paste a new key to replace it, or remove it.",
                        )
                      : gt(
                          "Paste the .pem file. It's saved in this environment's secret store and never sent back.",
                        )
                  }
                >
                  <div className="mt-3 flex max-w-2xl flex-col items-start gap-2 pb-3">
                    <Textarea
                      size="sm"
                      aria-label={gt("Private key")}
                      value={privateKey}
                      // oxlint-disable-next-line t3code/no-untranslated-copy -- PEM header, a file format
                      placeholder="-----BEGIN RSA PRIVATE KEY-----"
                      disabled={!canWrite}
                      onChange={(event) => setPrivateKeyText(event.target.value)}
                    />
                    <Button size="sm" variant="outline" disabled={!canWrite} onClick={saveKey}>
                      {privateKey.trim() === "" && state.identity.hasPrivateKey
                        ? gt("Remove key")
                        : gt("Store key")}
                    </Button>
                  </div>
                </SettingsRow>
              </>
            ) : null}
          </SettingsSection>

          <SettingsSection
            title={gt("Triggers", { $context: "settings section, events that start a review" })}
          >
            <SettingsRow
              title={gt("Command", { $context: "comment text that asks for a review" })}
              description={gt(
                "Comment this on a pull request to ask for a review. Text after it sets the focus. Reply with it to a bot comment to ask a question.",
              )}
              control={
                <Input
                  size="sm"
                  className="w-full sm:w-48"
                  placeholder={DEFAULT_PR_REVIEW_COMMAND}
                  value={config.command}
                  disabled={!canWrite}
                  onChange={(event) => edit({ command: event.target.value })}
                />
              }
            />
            <SettingsRow
              title={gt("Review when requested as a reviewer")}
              description={gt("GitHub App only. Requesting the bot reviews the latest commit.")}
              control={
                <Switch
                  checked={config.reviewOnRequest}
                  disabled={!canWrite}
                  onCheckedChange={(reviewOnRequest) => edit({ reviewOnRequest })}
                  aria-label={gt("Review when requested as a reviewer")}
                />
              }
            />
            <SettingsRow
              title={gt("Allowed users")}
              description={gt(
                "GitHub logins, comma separated. Empty allows collaborators with write access.",
              )}
              control={
                <Input
                  size="sm"
                  className="w-full sm:w-64"
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

          <SettingsSection title={gt("Repositories")}>
            {config.repositories.length === 0 ? (
              <SettingsRow
                title={gt("No repositories yet")}
                description={gt("Add a GitHub repository and the project that holds its checkout.")}
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
                <RepositoryRow
                  // oxlint-disable-next-line react/no-array-index-key -- Rows are controlled; a content key remounts the input on every keystroke.
                  key={index}
                  repo={repo}
                  projects={projects}
                  canWrite={canWrite}
                  onChange={replace}
                  onRemove={() =>
                    edit({
                      repositories: config.repositories.filter((_entry, at) => at !== index),
                    })
                  }
                />
              );
            })}
            <div className="px-3 py-2 sm:px-4">
              <Button
                size="compact"
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
                <PlusIcon />
                <T>Add repository</T>
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection title={gt("Reviewer rules")}>
            <SettingsRow
              title={gt("How the author is found")}
              description={gt(
                "From the T3 thread that opened or pushed the pull request, otherwise from its Co-Authored-By trailers. The first matching rule picks the reviewer.",
              )}
            />
            {config.rules.map((rule, index) => (
              <SettingsRow
                key={`${rule.authorProvider}:${rule.reviewer.instanceId}:${rule.reviewer.model}`}
                title={gt("Rule {number}", { number: index + 1 })}
                control={
                  <Button
                    size="icon-sm"
                    variant="ghost-destructive"
                    aria-label={gt("Remove rule")}
                    disabled={!canWrite}
                    onClick={() =>
                      edit({ rules: config.rules.filter((_entry, at) => at !== index) })
                    }
                  >
                    <XIcon />
                  </Button>
                }
              >
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 pb-3 text-sm text-muted-foreground">
                  <T>
                    <span>Written by</span>
                    <Var>
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
                        <SelectTrigger
                          size="sm"
                          className="w-full sm:w-40"
                          aria-label={gt("Author provider")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup alignItemWithTrigger={false}>
                          {AUTHOR_PROVIDERS.map(([value, label]) => (
                            <SelectItem hideIndicator key={value} value={value}>
                              {m(label)}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </Var>
                    <span>reviewed by</span>
                    <Var>
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
                    </Var>
                  </T>
                </div>
              </SettingsRow>
            ))}
            <div className="px-3 py-2 sm:px-4">
              <Button
                size="compact"
                variant="ghost-muted"
                disabled={!canWrite}
                onClick={() =>
                  edit({
                    rules: [
                      ...config.rules,
                      {
                        authorProvider:
                          AUTHOR_PROVIDERS.map(([value]) => value).find(
                            (value) => !config.rules.some((rule) => rule.authorProvider === value),
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
                <PlusIcon />
                <T>Add rule</T>
              </Button>
            </div>
            <SettingsRow
              title={gt("Otherwise", { $context: "fallback reviewer when no rule matches" })}
              description={gt("When no rule matches. Unset uses the environment's default model.")}
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

          <SettingsSection title={gt("Review instructions")}>
            <SettingsRow
              title={gt("Default instructions")}
              description={gt("Empty uses T3's default: verified defects only, no style nits.")}
            >
              <div className="mt-3 max-w-2xl pb-3">
                <Textarea
                  aria-label={gt("Default review instructions")}
                  value={config.instructions}
                  disabled={!canWrite}
                  onChange={(event) => edit({ instructions: event.target.value })}
                />
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={gt("History")}>
            <SettingsRow
              title={gt("Polling", { $context: "checking GitHub for new pull requests" })}
              description={
                state.polling.lastError
                  ? gt("Last poll failed: {error}", { error: state.polling.lastError })
                  : state.polling.lastPollAt
                    ? gt("Last polled {time}.", {
                        time: formatRelativeTimeLabel(state.polling.lastPollAt, undefined, m),
                      })
                    : config.enabled
                      ? gt("Waiting for the first poll.")
                      : gt("Off on this environment.")
              }
            />
            {state.history.length === 0 ? (
              <SettingsRow
                title={gt("No reviews yet")}
                description={gt("Reviews this environment runs show up here.")}
              />
            ) : null}
            {state.history.map((record) => (
              <HistoryRow
                key={record.id}
                environmentId={environmentId}
                record={record}
                canOperate={canOperate}
              />
            ))}
          </SettingsSection>
        </>
      ) : null}
      {dirty ? (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-popover px-4 py-2 shadow-lg">
          <span className="text-sm text-muted-foreground">
            <T>Unsaved changes</T>
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setDraft(null)}>
              <T context="verb, drop unsaved changes">Discard</T>
            </Button>
            <Button size="sm" disabled={saving || !canWrite} onClick={save}>
              {saving ? gt("Saving…") : gt("Save", { $context: "verb, save settings" })}
            </Button>
          </div>
        </div>
      ) : null}
    </SettingsPageContainer>
  );
}
