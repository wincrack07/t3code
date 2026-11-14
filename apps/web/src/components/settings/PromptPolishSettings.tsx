import {
  DEFAULT_PROMPT_POLISH_BASE,
  type PromptPolishSettings as Settings,
  type ModelSelection,
} from "@t3tools/contracts";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { createModelSelection } from "@t3tools/shared/model";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsWriteAllowed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";

const MAX_RULES = 30;

export function PromptPolishSettings() {
  const settings = useScopedSettings().promptPolish;
  const { targets } = useSettingsScope();
  const key = `${targets.map((target) => target.environmentId).join(",")}:${JSON.stringify(settings)}`;
  return <PromptPolishEditor key={key} initial={settings} />;
}

function PromptPolishEditor({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);
  const update = useUpdateScopedSettings();
  const writable = useScopedSettingsWriteAllowed();
  const updateRule = (index: number, patch: Partial<Settings["rules"][number]>) =>
    setSettings((current) => ({
      ...current,
      rules: current.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));

  return (
    <SettingsSection {...searchableSetting("prompt-polish")}>
      <PolishModelRow
        selection={settings.modelSelection ?? null}
        onChange={(modelSelection) => setSettings({ ...settings, modelSelection })}
      />
      <SettingsRow
        title="Instruction"
        description="How the model rewrites your draft."
        resetAction={
          settings.basePrompt !== DEFAULT_PROMPT_POLISH_BASE ? (
            <SettingResetButton
              label="polish instruction"
              onClick={() => setSettings({ ...settings, basePrompt: DEFAULT_PROMPT_POLISH_BASE })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            aria-label="Polish instruction"
            rows={4}
            maxLength={8000}
            value={settings.basePrompt}
            onChange={(event) => setSettings({ ...settings, basePrompt: event.target.value })}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        title="Rules"
        description="Added after the instruction. Turn a rule off to skip it."
      >
        {settings.rules.length > 0 ? (
          <div className="mt-3 min-w-0 max-w-2xl space-y-3">
            {settings.rules.map((rule, index) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- Controlled rows have no state tied to their position.
                key={index}
                role="group"
                aria-label={`Rule ${index + 1}`}
                className="space-y-2 rounded-lg border border-border p-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Switch
                    size="sm"
                    aria-label={`Enable ${rule.name || "rule"}`}
                    checked={rule.enabled}
                    onCheckedChange={(enabled) => updateRule(index, { enabled })}
                  />
                  <div className="min-w-0 flex-1">
                    <Input
                      size="sm"
                      aria-label={`Rule ${index + 1} name`}
                      value={rule.name}
                      maxLength={100}
                      onChange={(event) => updateRule(index, { name: event.target.value })}
                    />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost-destructive"
                    aria-label={`Remove ${rule.name || `rule ${index + 1}`}`}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        rules: settings.rules.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <XIcon />
                  </Button>
                </div>
                <Textarea
                  size="sm"
                  aria-label={`Rule ${index + 1} instruction`}
                  value={rule.text}
                  maxLength={2000}
                  rows={2}
                  onChange={(event) => updateRule(index, { text: event.target.value })}
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="pt-2 pb-2">
          <Button
            size="compact"
            variant="ghost-muted"
            disabled={settings.rules.length >= MAX_RULES}
            onClick={() =>
              setSettings({
                ...settings,
                rules: [...settings.rules, { name: "New rule", text: "", enabled: true }],
              })
            }
          >
            <PlusIcon />
            Add rule
          </Button>
        </div>
      </SettingsRow>
      {dirty ? (
        <SettingsRow
          title="Unsaved changes"
          control={
            <>
              <Button size="sm" variant="outline" onClick={() => setSettings(initial)}>
                Discard
              </Button>
              <Button
                size="sm"
                disabled={!writable}
                onClick={() => update({ promptPolish: settings })}
              >
                Save
              </Button>
            </>
          }
        />
      ) : null}
    </SettingsSection>
  );
}

function PolishModelRow({
  selection,
  onChange,
}: {
  selection: ModelSelection | null;
  onChange: (selection: ModelSelection | null) => void;
}) {
  const settings = useScopedSettings();
  const { environment } = useSettingsScope();
  const byEnvironment = useEnvironmentProviders();
  const providers =
    (environment ? byEnvironment.get(environment.environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(
    providers.filter((provider) => provider.supportsTextGeneration !== false),
    settings,
    null,
  );
  const selected = selection ?? settings.textGenerationModelSelection;
  const entry = entries.find((entry) => entry.instanceId === selected.instanceId);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selected.instanceId,
    selected.model,
  );
  const disabledReason = useScopedModelDisabledReason(settings, entries);
  return (
    <SettingsRow
      serverScoped
      settingKeys={["promptPolish"]}
      title="Model"
      description="Uses the text generation model unless you turn on a separate one."
      control={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {selection ? (
            <>
              <ProviderModelPicker
                environmentId={environment?.environmentId ?? null}
                activeInstanceId={selected.instanceId}
                model={selected.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptions}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                getModelDisabledReason={disabledReason}
                onInstanceModelChange={(instanceId, model) =>
                  onChange(createModelSelection(instanceId, model))
                }
              />
              {entry ? (
                <TraitsPicker
                  provider={entry.driverKind}
                  models={entry.models}
                  model={selected.model}
                  modelOptions={selected.options ?? []}
                  allowPromptInjectedEffort={false}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(options) =>
                    onChange(createModelSelection(selected.instanceId, selected.model, options))
                  }
                />
              ) : null}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Text generation model</span>
          )}
          <Switch
            aria-label="Use a separate Polish model"
            checked={selection !== null}
            disabled={
              !selection &&
              !entries.some(
                (entry) => entry.enabled && entry.isAvailable && entry.models.length > 0,
              )
            }
            onCheckedChange={(checked) => {
              const entry = entries.find(
                (candidate) =>
                  candidate.enabled && candidate.isAvailable && candidate.models.length > 0,
              );
              onChange(
                checked && entry
                  ? entries.some((candidate) => candidate.instanceId === selected.instanceId)
                    ? selected
                    : createModelSelection(entry.instanceId, entry.models[0]!.slug)
                  : null,
              );
            }}
          />
        </div>
      }
    />
  );
}
