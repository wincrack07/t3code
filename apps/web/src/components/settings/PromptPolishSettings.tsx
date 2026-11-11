import {
  DEFAULT_PROMPT_POLISH_BASE,
  type PromptPolishSettings as Settings,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsWriteAllowed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";

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
    <SettingsSection {...searchableSetting("prompt-polish")}>
      <div className="space-y-4 pb-4">
        <p>Choose the instruction and rules used to polish drafts in this environment.</p>
        <label htmlFor="polish-base">Base prompt</label>
        <Textarea
          id="polish-base"
          rows={4}
          maxLength={8000}
          value={settings.basePrompt}
          onChange={(event) => setSettings({ ...settings, basePrompt: event.target.value })}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSettings({ ...settings, basePrompt: DEFAULT_PROMPT_POLISH_BASE })}
        >
          Reset to default
        </Button>
        <div className="space-y-4">
          {settings.rules.map((rule, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- Controlled rows have no state tied to their position.
            <div key={index} className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  aria-label={`Enable ${rule.name || "rule"}`}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => updateRule(index, { enabled })}
                />
                <Input
                  aria-label={`Rule ${index + 1} name`}
                  value={rule.name}
                  maxLength={100}
                  onChange={(event) => updateRule(index, { name: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      rules: settings.rules.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
              <Textarea
                aria-label={`Rule ${index + 1} instruction`}
                value={rule.text}
                maxLength={2000}
                rows={2}
                onChange={(event) => updateRule(index, { text: event.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={settings.rules.length >= 30}
            onClick={() =>
              setSettings({
                ...settings,
                rules: [...settings.rules, { name: "New rule", text: "", enabled: true }],
              })
            }
          >
            Add rule
          </Button>
          <Button size="sm" disabled={!writable} onClick={() => update({ promptPolish: settings })}>
            Save
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
