import {
  DEFAULT_PROMPT_POLISH_BASE,
  type PromptPolishSettings as Settings,
} from "@t3tools/contracts";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
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
      <SettingsRow
        title="Instruction"
        description="Tells the model how to rewrite your draft when you polish it."
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
        description="Added after the instruction. Turn one off to skip it without deleting it."
        control={
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
        }
      >
        {settings.rules.length > 0 ? (
          <div className="mt-3 min-w-0 max-w-2xl space-y-4 pb-3.5">
            {settings.rules.map((rule, index) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- Controlled rows have no state tied to their position.
                key={index}
                role="group"
                aria-label={`Rule ${index + 1}`}
                className="space-y-2"
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
      </SettingsRow>
    </SettingsSection>
  );
}
