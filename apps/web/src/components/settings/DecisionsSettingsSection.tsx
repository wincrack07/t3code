import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  DecisionRule,
  ProjectId,
  ProviderInstanceId,
  type DecisionSettings,
} from "@t3tools/contracts";
import { ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const decodeRule = Schema.decodeUnknownSync(DecisionRule);

const DECISION_SOURCE_LABELS: Record<DecisionSettings["source"], string> = {
  provider: "Configured provider",
  openai: "OpenAI API",
};

const list = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function DecisionsSettingsSection() {
  const config = useScopedSettings((settings) => settings.decisions);
  const update = useUpdateScopedSettings();
  const { target } = useSettingsScope();
  const environmentId = target?.environmentId ?? null;
  const permission = useAtomValue(serverEnvironment.decide.permissionAtom(environmentId));
  const run = useAtomCommand(serverEnvironment.decide, { reportFailure: false });
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState("");
  const save = (patch: Partial<DecisionSettings>) => update({ decisions: { ...config, ...patch } });
  const nextRuleId = `rule-${config.rules.reduce((next, rule) => Math.max(next, Number(rule.id.replace("rule-", "")) || 0), 0) + 1}`;
  return (
    <SettingsSection id="decisions" title="Decisions">
      <SettingsRow
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
        title="Decision source"
        description="The model that picks where a prompt runs."
        control={
          <Select
            value={config.source}
            onValueChange={(value) => save({ source: value === "openai" ? "openai" : "provider" })}
          >
            <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Decision source">
              <SelectValue>
                {(value: DecisionSettings["source"]) => DECISION_SOURCE_LABELS[value]}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="provider">
                {DECISION_SOURCE_LABELS.provider}
              </SelectItem>
              <SelectItem hideIndicator value="openai">
                {DECISION_SOURCE_LABELS.openai}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {config.source === "openai" ? (
        <>
          <SettingsRow
            title="OpenAI model"
            control={
              <Input
                size="sm"
                className="w-full sm:w-48"
                aria-label="OpenAI model"
                value={config.openaiModel}
                onChange={(event) => save({ openaiModel: event.target.value })}
              />
            }
          />
          <SettingsRow
            title="API key"
            control={
              <Input
                size="sm"
                className="w-full sm:w-48"
                type="password"
                autoComplete="off"
                aria-label="API key"
                defaultValue={typeof config.apiKey === "string" ? config.apiKey : ""}
                onBlur={(event) => save({ apiKey: event.target.value })}
              />
            }
          />
        </>
      ) : (
        <>
          <SettingsRow
            title="Provider instance"
            description="Leave empty to use the first available provider's fast text model."
            control={
              <Input
                size="sm"
                font="mono"
                className="w-full sm:w-48"
                aria-label="Decision provider instance"
                defaultValue={config.modelSelection?.instanceId ?? ""}
                onBlur={(event) =>
                  save({
                    modelSelection: event.target.value.trim()
                      ? {
                          instanceId: ProviderInstanceId.make(event.target.value.trim()),
                          model: config.modelSelection?.model ?? "default",
                        }
                      : null,
                  })
                }
              />
            }
          />
          <SettingsRow
            title="Model"
            control={
              <Input
                size="sm"
                font="mono"
                className="w-full sm:w-48"
                aria-label="Decision model"
                defaultValue={config.modelSelection?.model ?? ""}
                disabled={!config.modelSelection}
                onBlur={(event) => {
                  if (config.modelSelection && event.target.value.trim())
                    save({
                      modelSelection: {
                        ...config.modelSelection,
                        model: event.target.value.trim(),
                      },
                    });
                }}
              />
            }
          />
        </>
      )}
      <SettingsRow
        title="Allowed environments"
        description="Environment IDs, comma separated. Leave empty to allow all."
        control={
          <Input
            size="sm"
            font="mono"
            className="w-full sm:w-48"
            aria-label="Allowed environment IDs"
            defaultValue={config.allowedEnvironmentIds?.join(", ") ?? ""}
            onBlur={(event) =>
              save({
                allowedEnvironmentIds: event.target.value.trim() ? list(event.target.value) : null,
              })
            }
          />
        }
      />
      <SettingsRow
        title="Allowed providers"
        description="Provider instance IDs, comma separated. Leave empty to allow all."
        control={
          <Input
            size="sm"
            font="mono"
            className="w-full sm:w-48"
            aria-label="Allowed provider instance IDs"
            defaultValue={config.allowedProviderInstanceIds?.join(", ") ?? ""}
            onBlur={(event) =>
              save({
                allowedProviderInstanceIds: event.target.value.trim()
                  ? list(event.target.value)
                  : null,
              })
            }
          />
        }
      />
      <SettingsRow
        title="Rules"
        description="Run top to bottom. Restrict narrows the options, decide picks the first one left and stops."
        control={
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
        {config.rules.length > 0 ? (
          <div className="mt-3 min-w-0 max-w-2xl space-y-4 pb-3.5">
            {config.rules.map((rule, index) => (
              <div key={rule.id} role="group" aria-label={rule.name} className="space-y-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Switch
                    size="sm"
                    aria-label={`Enable ${rule.name}`}
                    checked={rule.enabled}
                    onCheckedChange={(enabled) =>
                      save({
                        rules: config.rules.map((entry) =>
                          entry.id === rule.id ? { ...entry, enabled } : entry,
                        ),
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {rule.name}
                  </span>
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label={`Move ${rule.name} up`}
                    disabled={index === 0}
                    onClick={() => {
                      const rules = [...config.rules];
                      [rules[index - 1], rules[index]] = [rules[index]!, rules[index - 1]!];
                      save({ rules });
                    }}
                  >
                    <ArrowUpIcon className="size-3" />
                  </Button>
                  <Button
                    size="icon-micro"
                    variant="ghost-destructive"
                    aria-label={`Remove ${rule.name}`}
                    onClick={() =>
                      save({ rules: config.rules.filter((entry) => entry.id !== rule.id) })
                    }
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
                <RuleEditor
                  key={JSON.stringify(rule)}
                  rule={rule}
                  onSave={(next) =>
                    save({
                      rules: config.rules.map((entry) => (entry.id === rule.id ? next : entry)),
                    })
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Test a prompt"
        description="See where a prompt would run in a project, without starting a turn."
      >
        <div className="mt-3 min-w-0 max-w-2xl space-y-2 pb-3.5">
          <Input
            size="sm"
            font="mono"
            aria-label="Project ID"
            placeholder="Project ID"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          />
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
            disabled={!permission || !environmentId || !projectId.trim() || !prompt.trim()}
            onClick={async () => {
              if (!environmentId) return;
              setResult("Deciding…");
              const answer = await run({
                environmentId,
                input: { projectId: ProjectId.make(projectId.trim()), prompt },
              });
              setResult(
                answer._tag === "Success"
                  ? JSON.stringify(answer.value, null, 2)
                  : "Could not test this prompt.",
              );
            }}
          >
            Test prompt
          </Button>
          <pre
            aria-live="polite"
            className={cn(
              "overflow-x-auto font-mono text-xs text-muted-foreground",
              result && "rounded-lg border border-border/60 bg-muted/40 p-3",
            )}
          >
            {result}
          </pre>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

function RuleEditor({
  rule,
  onSave,
}: {
  rule: DecisionRule;
  onSave: (rule: DecisionRule) => void;
}) {
  const [draft, setDraft] = useState(JSON.stringify(rule, null, 2));
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <Textarea
        size="sm"
        aria-label={`Edit ${rule.name}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          try {
            const next = decodeRule(JSON.parse(draft));
            onSave({ ...next, id: rule.id });
            setError("");
          } catch {
            setError("Enter a valid rule with name, enabled, when, choose, and action.");
          }
        }}
      >
        Save rule
      </Button>
      <p role="status" className="text-xs text-destructive">
        {error}
      </p>
    </div>
  );
}
