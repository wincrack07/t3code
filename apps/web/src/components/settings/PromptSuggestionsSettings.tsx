import { createModelSelection } from "@t3tools/shared/model";
import { resolvePromptCompletionModelSelection } from "@t3tools/shared/serverSettings";

import { useTextGenerationTargets } from "../../textGenerators";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const DELAY_OPTIONS = [400, 700, 1_000, 1_500, 2_500] as const;

/** Model-written prompt suggestions in the composer. They run on the draft's environment. */
export function PromptSuggestionsSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection id="prompt-suggestions" title="Prompt suggestions">
      <SettingsRow
        serverScoped
        settingKeys={["promptCompletionNextEnabled"]}
        {...searchableSetting("prompt-completion-next")}
        description="After a reply, show likely next prompts in the empty input. Tab fills one in, Alt+] and Alt+[ switch between them."
        control={
          <Switch
            checked={settings.promptCompletionNextEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ promptCompletionNextEnabled: Boolean(checked) })
            }
            aria-label="Suggest a reply when the input is empty"
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["promptCompletionInlineEnabled"]}
        {...searchableSetting("prompt-completion-inline")}
        description="Show a likely continuation when you pause. Tab accepts it, Alt+Right or Ctrl+Right accepts one word, Escape dismisses it."
        control={
          <Switch
            checked={settings.promptCompletionInlineEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ promptCompletionInlineEnabled: Boolean(checked) })
            }
            aria-label="Complete while typing"
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["promptCompletionDelayMs"]}
        {...searchableSetting("prompt-completion-delay")}
        description="How long you pause before a suggestion is requested."
        control={
          <Select
            value={String(settings.promptCompletionDelayMs)}
            onValueChange={(value) => {
              const delay = Number(value);
              if (DELAY_OPTIONS.some((option) => option === delay)) {
                updateSettings({ promptCompletionDelayMs: delay });
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-32"
              aria-label="Pause before suggesting"
            >
              <SelectValue>{formatDelay(settings.promptCompletionDelayMs)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {DELAY_OPTIONS.map((delay) => (
                <SelectItem hideIndicator key={delay} value={String(delay)}>
                  {formatDelay(delay)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SuggestionModelRow />
    </SettingsSection>
  );
}

function formatDelay(delayMs: number): string {
  return delayMs < 1_000 ? `${delayMs} ms` : `${delayMs / 1_000} s`;
}

function SuggestionModelRow() {
  const { environment, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const targets = useTextGenerationTargets({
    environmentId: environment?.environmentId ?? null,
    settings,
    providers: providers.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: null,
    selections: [settings.promptCompletionModelSelection, settings.textGenerationModelSelection],
  });
  const instanceEntries = targets.entries;
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const dedicated = settings.promptCompletionModelSelection !== null;
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolvePromptCompletionModelSelection(
        settings,
        targets.providers,
      ),
    },
    targets.providers,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    targets.providers,
    selection.instanceId,
    selection.model,
  );
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  const setModel = (next: ReturnType<typeof createModelSelection>) => {
    const reason = modelDisabledReason(next.instanceId, next.model);
    if (reason) {
      toastManager.add({ type: "error", title: "Suggestion model not saved", description: reason });
      return;
    }
    updateSettings({ promptCompletionModelSelection: next });
  };
  return (
    <SettingsRow
      serverScoped
      settingKeys={["promptCompletionModelSelection"]}
      {...searchableSetting("prompt-completion-model")}
      description="Use a separate fast model for suggestions. When off, suggestions use the text generation model."
      control={
        connectedEnvironments.length === 0 ? (
          <span className="text-sm text-muted-foreground">Connect an environment first.</span>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {dedicated && hasProvider && instanceEntry ? (
              <>
                <ProviderModelPicker
                  environmentId={environment?.environmentId ?? null}
                  activeInstanceId={selection.instanceId}
                  model={selection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  getModelDisabledReason={modelDisabledReason}
                  onInstanceModelChange={(instanceId, model) =>
                    setModel(createModelSelection(instanceId, model))
                  }
                />
                <TraitsPicker
                  provider={instanceEntry.driverKind}
                  models={instanceEntry.models}
                  model={selection.model}
                  modelOptions={selection.options ?? []}
                  allowPromptInjectedEffort={false}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(options) =>
                    setModel(createModelSelection(selection.instanceId, selection.model, options))
                  }
                />
              </>
            ) : null}
            <Switch
              checked={dedicated}
              disabled={!dedicated && !hasProvider}
              onCheckedChange={(checked) =>
                updateSettings({
                  promptCompletionModelSelection: checked
                    ? createModelSelection(
                        settings.textGenerationModelSelection.instanceId,
                        settings.textGenerationModelSelection.model,
                        settings.textGenerationModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label="Use a separate suggestion model"
            />
          </div>
        )
      }
    />
  );
}
