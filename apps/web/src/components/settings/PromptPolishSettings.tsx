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
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
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
  const update = useUpdateScopedSettings();
  const writable = useScopedSettingsWriteAllowed();
  const updateRule = (index: number, patch: Partial<Settings["rules"][number]>) =>
    setSettings((current) => ({
      ...current,
      rules: current.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));

  return (
    <SettingsSection
      {...searchableSetting("prompt-polish")}
      headerAction={
        <Button size="sm" disabled={!writable} onClick={() => update({ promptPolish: settings })}>
          Save
        </Button>
      }
    >
      <PolishModelRow
        selection={settings.modelSelection ?? null}
        onChange={(modelSelection) => setSettings({ ...settings, modelSelection })}
      />
      <SettingsRow
        title="Base prompt"
        description="Tells the model how to rewrite your draft when you polish it."
        control={
          settings.basePrompt !== DEFAULT_PROMPT_POLISH_BASE ? (
            <Button
              size="sm"
              variant="ghost-muted"
              onClick={() => setSettings({ ...settings, basePrompt: DEFAULT_PROMPT_POLISH_BASE })}
            >
              Reset to default
            </Button>
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
        description="Added after the instruction. Turn one off to skip it without deleting it."
      >
        {settings.rules.length > 0 ? (
          <div className="mt-3 min-w-0 max-w-2xl space-y-4 pb-3.5">
            {settings.rules.map((rule, index) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- Controlled rows have no state tied to their position.
                key={index}
                role="group"
                aria-label={`Rule ${index + 1}`}
                className="space-y-2 rounded-lg border border-border/60 p-3"
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
                    size="icon-micro"
                    variant="ghost-destructive"
                    aria-label={`Remove ${rule.name || `rule ${index + 1}`}`}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        rules: settings.rules.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <XIcon className="size-3" />
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
        <div className="pb-3.5">
          <Button
            size="sm"
            variant="outline"
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
      description="Same as text generation unless you choose a separate model. Unavailable models fall back to text generation."
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
            <span className="text-sm text-muted-foreground">Same as text generation</span>
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
