import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ProjectId,
  PROVIDER_DISPLAY_NAMES,
  type DecisionRule,
  type DecisionSettings,
} from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { createModelSelection } from "@t3tools/shared/model";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsWriteAllowed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";

type Option = { value: string; label: string };
const SOURCES: Option[] = [
  { value: "provider", label: "Configured provider" },
  { value: "openai", label: "OpenAI API" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
];
const ROLES = ["implementation", "research", "review", "design", "test", "general"] as const;
const options = (values: readonly string[]): Option[] =>
  [...new Set(values)].map((value) => ({ value, label: value }));

function Picker({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-64" aria-label={label}>
        <SelectValue>
          {() => choices.find((choice) => choice.value === value)?.label ?? "Unavailable"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function Checklist({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: readonly string[];
  choices: readonly Option[];
  onChange: (value: string[]) => void;
}) {
  const missing = value.filter((id) => !choices.some((choice) => choice.value === id));
  return (
    <fieldset aria-label={label} className="max-h-56 min-w-0 space-y-2 overflow-y-auto sm:w-64">
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options available.</p>
      ) : null}
      {[...choices, ...missing.map((id) => ({ value: id, label: `Unavailable (${id})` }))].map(
        (choice) => (
          <label key={choice.value} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.includes(choice.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked ? [...value, choice.value] : value.filter((id) => id !== choice.value),
                )
              }
            />
            <span className="min-w-0 break-words">{choice.label}</span>
          </label>
        ),
      )}
    </fieldset>
  );
}

export function DecisionsSettingsSection() {
  const settings = useScopedSettings();
  const config = settings.decisions;
  const update = useUpdateScopedSettings();
  const writable = useScopedSettingsWriteAllowed();
  const { target, environment } = useSettingsScope();
  const environmentId = target?.environmentId ?? null;
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environmentId ? providersByEnvironment.get(environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const decisionEntries = entries.filter(
    (entry) => entry.snapshot.supportsTextGeneration !== false,
  );
  const getModelDisabledReason = useScopedModelDisabledReason(settings, decisionEntries);
  const modelOptions = getCustomModelOptionsByInstance(settings, providers);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const projectOptions = projects.map((project) => ({ value: project.id, label: project.title }));
  const environmentOptions = environments.map((entry) => ({
    value: entry.environmentId,
    label: entry.label,
  }));
  const providerOptions = entries.map((entry) => ({
    value: entry.instanceId,
    label: entry.displayName,
  }));
  const authorOptions = [
    ...new Map(
      entries.map(
        (entry) =>
          [
            entry.driverKind,
            {
              value: entry.driverKind,
              label: PROVIDER_DISPLAY_NAMES[entry.driverKind] ?? entry.driverKind,
            },
          ] as const,
      ),
    ).values(),
  ];
  const permission = useAtomValue(serverEnvironment.decide.permissionAtom(environmentId));
  const connectionPermission = useAtomValue(
    serverEnvironment.testDecisionConnection.permissionAtom(environmentId),
  );
  const run = useAtomCommand(serverEnvironment.decide, { reportFailure: false });
  const testConnection = useAtomCommand(serverEnvironment.testDecisionConnection, {
    reportFailure: false,
  });
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState("");
  const [connection, setConnection] = useState("");
  const [testing, setTesting] = useState(false);
  const save = (patch: Partial<DecisionSettings>) => update({ decisions: { ...config, ...patch } });
  const nextRuleId = `rule-${config.rules.reduce((next, rule) => Math.max(next, Number(rule.id.replace("rule-", "")) || 0), 0) + 1}`;
  const custom = config.source === "custom";
  const selection = config.modelSelection;
  const saveRule = (rule: DecisionRule) =>
    save({ rules: config.rules.map((entry) => (entry.id === rule.id ? rule : entry)) });
  return (
    <div className="space-y-6" inert={!writable}>
      <SettingsSection id="decisions" title="Decisions">
        <SettingsRow
          serverScoped
          settingKeys={["decisions"]}
          title="Automatic routing"
          description="Adds Auto to the model picker and applies your rules before a turn starts."
          control={
            <Switch
              aria-label="Enable Decisions"
              checked={config.enabled}
              onCheckedChange={(enabled) => save({ enabled })}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["decisions"]}
          title="Decision source"
          description="The model that picks where a prompt runs."
          control={
            <Picker
              label="Decision source"
              value={config.source}
              choices={SOURCES}
              onChange={(value) => {
                if (value === "provider" || value === "openai" || value === "custom") {
                  save({ source: value });
                  setConnection("");
                }
              }}
            />
          }
        />
        {config.source === "provider" ? (
          <SettingsRow
            title="Decision model"
            description="Automatic uses the first available provider's fast text model."
            control={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {selection ? (
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={selection.instanceId}
                    model={selection.model}
                    lockedProvider={null}
                    instanceEntries={decisionEntries}
                    modelOptionsByInstance={modelOptions}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    getModelDisabledReason={getModelDisabledReason}
                    onInstanceModelChange={(instanceId, model) =>
                      save({ modelSelection: createModelSelection(instanceId, model) })
                    }
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">Automatic</span>
                )}
                <Switch
                  aria-label="Use a specific decision model"
                  checked={selection !== null}
                  disabled={
                    !selection &&
                    !decisionEntries.some(
                      (entry) => entry.enabled && entry.isAvailable && entry.models.length > 0,
                    )
                  }
                  onCheckedChange={(checked) => {
                    const entry = decisionEntries.find(
                      (candidate) =>
                        candidate.enabled && candidate.isAvailable && candidate.models.length > 0,
                    );
                    save({
                      modelSelection:
                        checked && entry
                          ? createModelSelection(entry.instanceId, entry.models[0]!.slug)
                          : null,
                    });
                  }}
                />
              </div>
            }
          />
        ) : (
          <>
            {custom ? (
              <SettingsRow
                title="Base URL"
                description="Include the API prefix, such as /v1. Use HTTPS, or HTTP on loopback or a tailnet."
                control={
                  <Input
                    key={`${environmentId}-url`}
                    size="sm"
                    className="w-full sm:w-64"
                    aria-label="Custom base URL"
                    placeholder="https://example.com/v1"
                    defaultValue={config.customBaseUrl ?? ""}
                    onBlur={(event) => save({ customBaseUrl: event.target.value.trim() })}
                  />
                }
              />
            ) : null}
            <SettingsRow
              title="Model name"
              control={
                <Input
                  key={`${environmentId}-${config.source}-model`}
                  size="sm"
                  className="w-full sm:w-64"
                  aria-label="Decision API model"
                  defaultValue={custom ? (config.customModel ?? "") : config.openaiModel}
                  onBlur={(event) =>
                    save(
                      custom
                        ? { customModel: event.target.value.trim() }
                        : { openaiModel: event.target.value.trim() },
                    )
                  }
                />
              }
            />
            <SettingsRow
              title="API key"
              description="Stored in this environment's secret store."
              control={
                <Input
                  key={`${environmentId}-${config.source}-key`}
                  size="sm"
                  className="w-full sm:w-64"
                  type="password"
                  autoComplete="off"
                  aria-label="Decision API key"
                  defaultValue={
                    typeof (custom ? config.customApiKey : config.apiKey) === "string"
                      ? ((custom ? config.customApiKey : config.apiKey) as string)
                      : ""
                  }
                  onBlur={(event) =>
                    save(
                      custom
                        ? { customApiKey: event.target.value }
                        : { apiKey: event.target.value },
                    )
                  }
                />
              }
            />
            <SettingsRow
              title="Test connection"
              description={`Tests the saved settings on ${environment?.label ?? "the selected environment"}.`}
              status={connection || undefined}
              control={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connectionPermission || !environmentId || testing}
                  onClick={async () => {
                    if (!environmentId) return;
                    setTesting(true);
                    const answer = await testConnection({ environmentId, input: {} });
                    setConnection(
                      answer._tag === "Success"
                        ? answer.value.message
                        : "Could not test the connection.",
                    );
                    setTesting(false);
                  }}
                >
                  {testing ? "Testing…" : "Test connection"}
                </Button>
              }
            />
          </>
        )}
      </SettingsSection>
      <SettingsSection title="Routing options">
        <SettingsRow
          title="Allowed environments"
          description="Leave all unchecked to allow every environment."
          control={
            <Checklist
              label="Allowed environments"
              value={config.allowedEnvironmentIds ?? []}
              choices={environmentOptions}
              onChange={(value) => save({ allowedEnvironmentIds: value.length ? value : null })}
            />
          }
        />
        <SettingsRow
          title="Allowed providers"
          description="Leave all unchecked to allow every provider instance."
          control={
            <Checklist
              label="Allowed provider instances"
              value={config.allowedProviderInstanceIds ?? []}
              choices={providerOptions}
              onChange={(value) =>
                save({ allowedProviderInstanceIds: value.length ? value : null })
              }
            />
          }
        />
      </SettingsSection>
      <SettingsSection
        title="Rules"
        headerAction={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              save({
                rules: [
                  ...config.rules,
                  {
                    id: nextRuleId,
                    name: "New rule",
                    enabled: true,
                    when: {},
                    choose: {},
                    action: "restrict",
                  },
                ],
              })
            }
          >
            <PlusIcon />
            Add rule
          </Button>
        }
      >
        {config.rules.length === 0 ? (
          <SettingsRow
            title="No routing rules"
            description="Rules run top to bottom. Restrict narrows the options; decide picks the first remaining option and stops."
          />
        ) : (
          config.rules.map((rule, index) => {
            const move = (offset: number) => {
              const rules = [...config.rules];
              [rules[index], rules[index + offset]] = [rules[index + offset]!, rules[index]!];
              save({ rules });
            };
            const ruleEntries = entries.filter(
              (entry) =>
                !rule.choose.providerInstanceIds?.length ||
                rule.choose.providerInstanceIds.includes(entry.instanceId),
            );
            const models = [
              ...new Map(
                ruleEntries.flatMap((entry) =>
                  (modelOptions.get(entry.instanceId) ?? entry.models).map(
                    (model) => [model.slug, { value: model.slug, label: model.name }] as const,
                  ),
                ),
              ).values(),
            ];
            const efforts = options(
              ruleEntries.flatMap((entry) =>
                entry.models
                  .filter(
                    (model) =>
                      !rule.choose.models?.length || rule.choose.models.includes(model.slug),
                  )
                  .flatMap(
                    (model) =>
                      model.capabilities?.optionDescriptors?.flatMap((descriptor) =>
                        descriptor.type === "select" &&
                        (descriptor.role === "reasoning" || descriptor.id === "reasoningEffort")
                          ? descriptor.options.map((option) => option.id)
                          : [],
                      ) ?? [],
                  ),
              ),
            );
            return (
              <SettingsRow
                key={rule.id}
                title={rule.name}
                control={
                  <>
                    <Switch
                      size="sm"
                      aria-label={`Enable ${rule.name}`}
                      checked={rule.enabled}
                      onCheckedChange={(enabled) => saveRule({ ...rule, enabled })}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={`Move ${rule.name} up`}
                      disabled={index === 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={`Move ${rule.name} down`}
                      disabled={index === config.rules.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-destructive"
                      aria-label={`Remove ${rule.name}`}
                      onClick={() =>
                        save({ rules: config.rules.filter((entry) => entry.id !== rule.id) })
                      }
                    >
                      <XIcon />
                    </Button>
                  </>
                }
              >
                <details className="mt-3 pb-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Edit conditions and target
                  </summary>
                  <div className="mt-3 space-y-3">
                    <SettingsRow
                      title="Rule name"
                      control={
                        <Input
                          size="sm"
                          className="w-full sm:w-64"
                          aria-label="Rule name"
                          defaultValue={rule.name}
                          onBlur={(event) => saveRule({ ...rule, name: event.target.value })}
                        />
                      }
                    />
                    <SettingsRow
                      title="Project"
                      description="All projects when none are selected."
                      control={
                        <Checklist
                          label="Rule projects"
                          value={rule.when.projectIds ?? []}
                          choices={projectOptions}
                          onChange={(projectIds) =>
                            saveRule({
                              ...rule,
                              when: {
                                ...rule.when,
                                projectIds: projectIds.length ? projectIds : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Kind of work"
                      control={
                        <Checklist
                          label="Kind of work"
                          value={rule.when.roles ?? []}
                          choices={options(ROLES)}
                          onChange={(values) =>
                            saveRule({
                              ...rule,
                              when: {
                                ...rule.when,
                                roles: values.length
                                  ? ROLES.filter((role) => values.includes(role))
                                  : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Author provider"
                      control={
                        <Checklist
                          label="Author provider"
                          value={rule.when.authorDrivers ?? []}
                          choices={authorOptions}
                          onChange={(authorDrivers) =>
                            saveRule({
                              ...rule,
                              when: {
                                ...rule.when,
                                authorDrivers: authorDrivers.length ? authorDrivers : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Author instance"
                      control={
                        <Checklist
                          label="Author instance"
                          value={rule.when.authorInstanceIds ?? []}
                          choices={providerOptions}
                          onChange={(authorInstanceIds) =>
                            saveRule({
                              ...rule,
                              when: {
                                ...rule.when,
                                authorInstanceIds: authorInstanceIds.length
                                  ? authorInstanceIds
                                  : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Action"
                      control={
                        <Picker
                          label="Rule action"
                          value={rule.action}
                          choices={[
                            { value: "restrict", label: "Restrict options" },
                            { value: "decide", label: "Decide and stop" },
                          ]}
                          onChange={(action) =>
                            saveRule({
                              ...rule,
                              action: action === "decide" ? "decide" : "restrict",
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Provider instance"
                      control={
                        <Checklist
                          label="Rule provider instances"
                          value={rule.choose.providerInstanceIds ?? []}
                          choices={providerOptions}
                          onChange={(providerInstanceIds) =>
                            saveRule({
                              ...rule,
                              choose: {
                                ...rule.choose,
                                providerInstanceIds: providerInstanceIds.length
                                  ? providerInstanceIds
                                  : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Provider type"
                      control={
                        <Checklist
                          label="Rule provider types"
                          value={rule.choose.drivers ?? []}
                          choices={authorOptions}
                          onChange={(drivers) =>
                            saveRule({
                              ...rule,
                              choose: {
                                ...rule.choose,
                                drivers: drivers.length ? drivers : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Model"
                      control={
                        <Checklist
                          label="Rule models"
                          value={rule.choose.models ?? []}
                          choices={models}
                          onChange={(models) =>
                            saveRule({
                              ...rule,
                              choose: {
                                ...rule.choose,
                                models: models.length ? models : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Effort"
                      description="All efforts when none are selected."
                      control={
                        <Checklist
                          label="Rule efforts"
                          value={rule.choose.efforts ?? []}
                          choices={efforts}
                          onChange={(efforts) =>
                            saveRule({
                              ...rule,
                              choose: {
                                ...rule.choose,
                                efforts: efforts.length ? efforts : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                    <SettingsRow
                      title="Environment"
                      control={
                        <Checklist
                          label="Rule environments"
                          value={rule.choose.environmentIds ?? []}
                          choices={environmentOptions}
                          onChange={(environmentIds) =>
                            saveRule({
                              ...rule,
                              choose: {
                                ...rule.choose,
                                environmentIds: environmentIds.length ? environmentIds : undefined,
                              },
                            })
                          }
                        />
                      }
                    />
                  </div>
                </details>
              </SettingsRow>
            );
          })
        )}
      </SettingsSection>
      <SettingsSection title="Test a prompt">
        <SettingsRow
          title="Project"
          control={
            <Picker
              label="Test project"
              value={projectId}
              choices={[{ value: "", label: "Choose a project" }, ...projectOptions]}
              onChange={setProjectId}
            />
          }
        />
        <SettingsRow
          title="Prompt"
          description="See the chosen option and reason without starting a turn."
        >
          <div className="mt-3 space-y-3 pb-3.5">
            <Textarea
              size="sm"
              aria-label="Test a prompt"
              placeholder="Prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!permission || !environmentId || !projectId || !prompt.trim() || testing}
              onClick={async () => {
                if (!environmentId) return;
                setTesting(true);
                setResult("Deciding…");
                const answer = await run({
                  environmentId,
                  input: { projectId: ProjectId.make(projectId), prompt },
                });
                if (answer._tag === "Success") {
                  const { choice, reason } = answer.value;
                  const provider = entries.find(
                    (entry) => entry.instanceId === choice?.providerInstanceId,
                  );
                  const host = environments.find(
                    (entry) => entry.environmentId === choice?.environmentId,
                  );
                  setResult(
                    `${choice ? `${provider?.displayName ?? "Unavailable provider"} · ${choice.model}${choice.effort ? ` · ${choice.effort}` : ""} · ${host?.label ?? "Unavailable environment"}` : "Normal defaults"}\n${reason}`,
                  );
                } else setResult("Could not test this prompt.");
                setTesting(false);
              }}
            >
              Test prompt
            </Button>
            {result ? (
              <p
                role="status"
                className="whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground"
              >
                {result}
              </p>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
