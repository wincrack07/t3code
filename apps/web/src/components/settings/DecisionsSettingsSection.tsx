import { type ReactNode, useState } from "react";
import { msg, T, useGT, useMessages } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import {
  ProjectId,
  PROVIDER_DISPLAY_NAMES,
  type DecisionRule,
  type DecisionSettings,
} from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { createModelSelection } from "@t3tools/shared/model";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
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
import { m as resolveMessage, type MessageResolver } from "../../i18n/messages";

type Option = { value: string; label: string };
const SOURCES: Option[] = [
  { value: "provider", label: msg("Configured provider") },
  // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
  { value: "jev", label: "Jev (TypeSafe)" },
  // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
  { value: "openai", label: "OpenAI API" },
  { value: "custom", label: msg("OpenAI-compatible API") },
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
  const gt = useGT();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={label}>
        <SelectValue>
          {() => choices.find((choice) => choice.value === value)?.label ?? gt("Unavailable")}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {choices.map((choice) => (
          <SelectItem hideIndicator key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A select-style menu of checkboxes. Nothing checked means no limit. */
function MultiPicker({
  label,
  value,
  choices,
  emptyLabel,
  onChange,
}: {
  label: string;
  value: readonly string[];
  choices: readonly Option[];
  emptyLabel: string;
  onChange: (value: string[]) => void;
}) {
  const gt = useGT();
  const all = [
    ...choices,
    ...value
      .filter((id) => !choices.some((choice) => choice.value === id))
      .map((id) => ({ value: id, label: gt("Unavailable ({id})", { id }) })),
  ];
  const summary =
    value.length === 0
      ? emptyLabel
      : value.length === 1
        ? (all.find((choice) => choice.value === value[0])?.label ?? value[0])
        : gt("{count} selected", { count: value.length });
  return (
    <Menu>
      <MenuTrigger
        render={<SelectButton size="sm" className="w-full sm:w-56" aria-label={label} />}
      >
        {summary}
      </MenuTrigger>
      <MenuPopup align="end">
        {all.length === 0 ? (
          <MenuItem disabled>
            <T>No options</T>
          </MenuItem>
        ) : null}
        {all.map((choice) => (
          <MenuCheckboxItem
            key={choice.value}
            checked={value.includes(choice.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...value, choice.value] : value.filter((id) => id !== choice.value),
              )
            }
          >
            {choice.label}
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}

function ruleSummary(rule: DecisionRule, resolve: MessageResolver = resolveMessage): string {
  const conditions = Object.values(rule.when).filter((value) => value?.length).length;
  const targets = Object.values(rule.choose).filter((value) => value?.length).length;
  return [
    rule.action === "decide" ? resolve(msg("Decide and stop")) : resolve(msg("Restrict options")),
    conditions === 0
      ? resolve(msg("every prompt"))
      : resolve(
          msg("{count, plural, one {{count} condition} other {{count} conditions}}", {
            count: conditions,
          }),
        ),
    targets === 0
      ? resolve(msg("no target set"))
      : resolve(
          msg("{count, plural, one {{count} target} other {{count} targets}}", { count: targets }),
        ),
  ].join(" · ");
}

export function DecisionsSettingsSection() {
  const gt = useGT();
  const m = useMessages();
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = config.rules.find((rule) => rule.id === editingId) ?? null;
  const save = (patch: Partial<DecisionSettings>) => update({ decisions: { ...config, ...patch } });
  const nextRuleId = `rule-${config.rules.reduce((next, rule) => Math.max(next, Number(rule.id.replace("rule-", "")) || 0), 0) + 1}`;
  const custom = config.source === "custom";
  const apiKey =
    config.source === "jev" ? config.jevApiKey : custom ? config.customApiKey : config.apiKey;
  const selection = config.modelSelection;
  const saveRule = (rule: DecisionRule) =>
    save({ rules: config.rules.map((entry) => (entry.id === rule.id ? rule : entry)) });
  const ruleOptions = (rule: DecisionRule) => {
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
          .filter((model) => !rule.choose.models?.length || rule.choose.models.includes(model.slug))
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
    return { models, efforts };
  };
  const setWhen = (rule: DecisionRule, patch: Partial<DecisionRule["when"]>) =>
    saveRule({ ...rule, when: { ...rule.when, ...patch } });
  const setChoose = (rule: DecisionRule, patch: Partial<DecisionRule["choose"]>) =>
    saveRule({ ...rule, choose: { ...rule.choose, ...patch } });
  const listOrUndefined = <T,>(values: readonly T[]) => (values.length ? [...values] : undefined);
  const editingOptions = editing ? ruleOptions(editing) : null;

  return (
    <div className="flex flex-col gap-8" inert={!writable}>
      <SettingsSection id="decisions" title={gt("Decisions")}>
        <SettingsRow
          serverScoped
          settingKeys={["decisions"]}
          title={gt("Automatic routing")}
          description={gt(
            "Adds Auto to the model picker and applies your rules before a turn starts.",
          )}
          control={
            <Switch
              aria-label={gt("Enable Decisions")}
              checked={config.enabled}
              onCheckedChange={(enabled) => save({ enabled })}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["decisions"]}
          title={gt("Decision source")}
          description={gt("Which model picks where a prompt runs.")}
          control={
            <Picker
              label={gt("Decision source")}
              value={config.source}
              choices={SOURCES.map((source) => ({ ...source, label: m(source.label) }))}
              onChange={(value) => {
                if (
                  value === "provider" ||
                  value === "openai" ||
                  value === "custom" ||
                  value === "jev"
                ) {
                  save({ source: value });
                  setConnection("");
                }
              }}
            />
          }
        />
        {config.source === "provider" ? (
          <SettingsRow
            title={gt("Decision model")}
            description={gt("Automatic uses the first available provider's fast model.")}
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
                  <span className="text-sm text-muted-foreground">
                    <T>Automatic</T>
                  </span>
                )}
                <Switch
                  aria-label={gt("Use a specific decision model")}
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
                title={gt("Base URL")}
                description={gt(
                  "Include the API prefix, such as /v1. HTTP works only on loopback or a tailnet.",
                )}
                control={
                  <Input
                    key={`${environmentId}-url`}
                    size="sm"
                    className="w-full sm:w-56"
                    aria-label={gt("Custom base URL")}
                    placeholder="https://example.com/v1"
                    defaultValue={config.customBaseUrl ?? ""}
                    onBlur={(event) => save({ customBaseUrl: event.target.value.trim() })}
                  />
                }
              />
            ) : null}
            <SettingsRow
              title={gt("Model name")}
              description={gt("The model ID the API expects.")}
              control={
                <Input
                  key={`${environmentId}-${config.source}-model`}
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label={gt("Decision API model")}
                  defaultValue={
                    config.source === "jev"
                      ? (config.jevModel ?? "jev-latest")
                      : custom
                        ? (config.customModel ?? "")
                        : config.openaiModel
                  }
                  onBlur={(event) =>
                    save(
                      config.source === "jev"
                        ? { jevModel: event.target.value.trim() }
                        : custom
                          ? { customModel: event.target.value.trim() }
                          : { openaiModel: event.target.value.trim() },
                    )
                  }
                />
              }
            />
            <SettingsRow
              title={gt("API key")}
              description={gt("Stored in this environment's secret store.")}
              control={
                <Input
                  key={`${environmentId}-${config.source}-key`}
                  size="sm"
                  className="w-full sm:w-56"
                  type="password"
                  autoComplete="off"
                  aria-label={gt("Decision API key")}
                  defaultValue={typeof apiKey === "string" ? apiKey : ""}
                  onBlur={(event) =>
                    save(
                      config.source === "jev"
                        ? { jevApiKey: event.target.value }
                        : custom
                          ? { customApiKey: event.target.value }
                          : { apiKey: event.target.value },
                    )
                  }
                />
              }
            />
            <SettingsRow
              title={gt("Test connection")}
              description={
                environment
                  ? gt("Uses the saved settings on {environment}.", {
                      environment: environment.label,
                    })
                  : gt("Uses the saved settings on the selected environment.")
              }
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
                        : gt("Could not test the connection."),
                    );
                    setTesting(false);
                  }}
                >
                  {testing ? gt("Testing…") : gt("Test connection")}
                </Button>
              }
            />
          </>
        )}
      </SettingsSection>
      <SettingsSection title={gt("Limits")}>
        <SettingsRow
          title={gt("Environments")}
          description={gt("Where Auto may run a prompt.")}
          control={
            <MultiPicker
              label={gt("Allowed environments")}
              emptyLabel={gt("All environments")}
              value={config.allowedEnvironmentIds ?? []}
              choices={environmentOptions}
              onChange={(value) => save({ allowedEnvironmentIds: value.length ? value : null })}
            />
          }
        />
        <SettingsRow
          title={gt("Providers")}
          description={gt("Which provider instances Auto may pick.")}
          control={
            <MultiPicker
              label={gt("Allowed provider instances")}
              emptyLabel={gt("All providers")}
              value={config.allowedProviderInstanceIds ?? []}
              choices={providerOptions}
              onChange={(value) =>
                save({ allowedProviderInstanceIds: value.length ? value : null })
              }
            />
          }
        />
      </SettingsSection>
      <SettingsSection title={gt("Rules")}>
        {config.rules.length === 0 ? (
          <SettingsRow
            title={gt("No rules yet")}
            description={gt(
              "Rules run top to bottom. Restrict narrows the options. Decide picks the first remaining option and stops.",
            )}
          />
        ) : (
          config.rules.map((rule, index) => {
            const move = (offset: number) => {
              const rules = [...config.rules];
              [rules[index], rules[index + offset]] = [rules[index + offset]!, rules[index]!];
              save({ rules });
            };
            return (
              <SettingsRow
                key={rule.id}
                title={rule.name}
                description={ruleSummary(rule, m)}
                control={
                  <div className="flex items-center gap-1">
                    <Switch
                      size="sm"
                      aria-label={gt("Enable {name}", { name: rule.name })}
                      checked={rule.enabled}
                      onCheckedChange={(enabled) => saveRule({ ...rule, enabled })}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={gt("Edit {name}", { name: rule.name })}
                      onClick={() => setEditingId(rule.id)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={gt("Move {name} up", { name: rule.name })}
                      disabled={index === 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={gt("Move {name} down", { name: rule.name })}
                      disabled={index === config.rules.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-destructive"
                      aria-label={gt("Remove {name}", { name: rule.name })}
                      onClick={() =>
                        save({ rules: config.rules.filter((entry) => entry.id !== rule.id) })
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                }
              />
            );
          })
        )}
        <div className="px-3 py-2 sm:px-4">
          <Button
            size="compact"
            variant="ghost-muted"
            onClick={() => {
              save({
                rules: [
                  ...config.rules,
                  {
                    id: nextRuleId,
                    name: gt("New rule"),
                    enabled: true,
                    when: {},
                    choose: {},
                    action: "restrict",
                  },
                ],
              });
              setEditingId(nextRuleId);
            }}
          >
            <PlusIcon />
            <T>Add rule</T>
          </Button>
        </div>
      </SettingsSection>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditingId(null))}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <T>Edit rule</T>
            </DialogTitle>
          </DialogHeader>
          {editing && editingOptions ? (
            <DialogPanel>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <Field label={gt("Name")}>
                    <Input
                      key={editing.id}
                      size="sm"
                      className="w-full sm:w-56"
                      aria-label={gt("Rule name")}
                      defaultValue={editing.name}
                      onBlur={(event) => saveRule({ ...editing, name: event.target.value })}
                    />
                  </Field>
                  <Field label={gt("Action", { $context: "rule action type" })}>
                    <Picker
                      label={gt("Rule action")}
                      value={editing.action}
                      choices={[
                        { value: "restrict", label: gt("Restrict options") },
                        { value: "decide", label: gt("Decide and stop") },
                      ]}
                      onChange={(action) =>
                        saveRule({
                          ...editing,
                          action: action === "decide" ? "decide" : "restrict",
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    <T context="rule section: conditions">When</T>
                  </h3>
                  <Field label={gt("Project")}>
                    <MultiPicker
                      label={gt("Rule projects")}
                      emptyLabel={gt("Any project")}
                      value={editing.when.projectIds ?? []}
                      choices={projectOptions}
                      onChange={(projectIds) =>
                        setWhen(editing, {
                          projectIds: listOrUndefined(projectIds),
                        })
                      }
                    />
                  </Field>
                  <Field label={gt("Kind of work")}>
                    <MultiPicker
                      label={gt("Kind of work")}
                      emptyLabel={gt("Any kind")}
                      value={editing.when.roles ?? []}
                      choices={options(ROLES)}
                      onChange={(values) =>
                        setWhen(editing, {
                          roles: listOrUndefined(ROLES.filter((role) => values.includes(role))),
                        })
                      }
                    />
                  </Field>
                  <Field label={gt("Author provider")}>
                    <MultiPicker
                      label={gt("Author provider")}
                      emptyLabel={gt("Any provider")}
                      value={editing.when.authorDrivers ?? []}
                      choices={authorOptions}
                      onChange={(authorDrivers) =>
                        setWhen(editing, { authorDrivers: listOrUndefined(authorDrivers) })
                      }
                    />
                  </Field>
                  <Field label={gt("Author instance")}>
                    <MultiPicker
                      label={gt("Author instance")}
                      emptyLabel={gt("Any instance")}
                      value={editing.when.authorInstanceIds ?? []}
                      choices={providerOptions}
                      onChange={(authorInstanceIds) =>
                        setWhen(editing, { authorInstanceIds: listOrUndefined(authorInstanceIds) })
                      }
                    />
                  </Field>
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    <T context="rule section: what to pick">Choose</T>
                  </h3>
                  <Field label={gt("Provider instance")}>
                    <MultiPicker
                      label={gt("Rule provider instances")}
                      emptyLabel={gt("Any instance")}
                      value={editing.choose.providerInstanceIds ?? []}
                      choices={providerOptions}
                      onChange={(providerInstanceIds) =>
                        setChoose(editing, {
                          providerInstanceIds: listOrUndefined(providerInstanceIds),
                        })
                      }
                    />
                  </Field>
                  <Field label={gt("Provider type")}>
                    <MultiPicker
                      label={gt("Rule provider types")}
                      emptyLabel={gt("Any type")}
                      value={editing.choose.drivers ?? []}
                      choices={authorOptions}
                      onChange={(drivers) =>
                        setChoose(editing, { drivers: listOrUndefined(drivers) })
                      }
                    />
                  </Field>
                  <Field label={gt("Model")}>
                    <MultiPicker
                      label={gt("Rule models")}
                      emptyLabel={gt("Any model")}
                      value={editing.choose.models ?? []}
                      choices={editingOptions.models}
                      onChange={(models) => setChoose(editing, { models: listOrUndefined(models) })}
                    />
                  </Field>
                  <Field label={gt("Effort", { $context: "reasoning effort" })}>
                    <MultiPicker
                      label={gt("Rule efforts")}
                      emptyLabel={gt("Any effort")}
                      value={editing.choose.efforts ?? []}
                      choices={editingOptions.efforts}
                      onChange={(efforts) =>
                        setChoose(editing, { efforts: listOrUndefined(efforts) })
                      }
                    />
                  </Field>
                  <Field label={gt("Environment")}>
                    <MultiPicker
                      label={gt("Rule environments")}
                      emptyLabel={gt("Any environment")}
                      value={editing.choose.environmentIds ?? []}
                      choices={environmentOptions}
                      onChange={(environmentIds) =>
                        setChoose(editing, { environmentIds: listOrUndefined(environmentIds) })
                      }
                    />
                  </Field>
                </div>
              </div>
            </DialogPanel>
          ) : null}
          <DialogFooter variant="bare">
            <Button onClick={() => setEditingId(null)}>
              <T>Done</T>
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <SettingsSection title={gt("Test a prompt")}>
        <SettingsRow
          title={gt("Project")}
          control={
            <Picker
              label={gt("Test project")}
              value={projectId}
              choices={[{ value: "", label: gt("Choose a project") }, ...projectOptions]}
              onChange={setProjectId}
            />
          }
        />
        <SettingsRow
          title={gt("Prompt", { $context: "noun" })}
          description={gt("Shows what Auto would pick and why, without starting a turn.")}
        >
          <div className="mt-3 flex max-w-2xl flex-col items-start gap-3 pb-3.5">
            <Textarea
              size="sm"
              aria-label={gt("Test a prompt")}
              placeholder={gt("Fix the flaky login test")}
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
                setResult(gt("Deciding…"));
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
                    `${choice ? `${provider?.displayName ?? gt("Unavailable provider")} · ${choice.model}${choice.effort ? ` · ${choice.effort}` : ""} · ${host?.label ?? gt("Unavailable environment")}` : gt("Normal defaults")}\n${reason}`,
                  );
                } else setResult(gt("Could not test this prompt."));
                setTesting(false);
              }}
            >
              <T>Test prompt</T>
            </Button>
            {result ? (
              <p
                role="status"
                className="w-full whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm text-muted-foreground"
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
