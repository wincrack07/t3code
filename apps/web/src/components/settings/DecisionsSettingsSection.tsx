import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  DecisionRule,
  ProjectId,
  ProviderInstanceId,
  type DecisionSettings,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const decodeRule = Schema.decodeUnknownSync(DecisionRule);

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
  return (
    <SettingsSection id="decisions" title="Decisions">
      <SettingsRow
        title="Decision preview"
        description="Test your rules and decision model against this server’s usable providers without starting work."
        control={
          <Switch
            aria-label="Enable Decisions"
            checked={config.enabled}
            onCheckedChange={(enabled) => save({ enabled })}
          />
        }
      />
      <label>
        Decision source
        <select
          value={config.source}
          onChange={(event) =>
            save({ source: event.target.value === "openai" ? "openai" : "provider" })
          }
        >
          <option value="provider">Configured provider</option>
          <option value="openai">OpenAI API</option>
        </select>
      </label>
      {config.source === "openai" ? (
        <>
          <label>
            OpenAI model
            <Input
              value={config.openaiModel}
              onChange={(event) => save({ openaiModel: event.target.value })}
            />
          </label>
          <label>
            API key
            <Input
              type="password"
              autoComplete="off"
              defaultValue={typeof config.apiKey === "string" ? config.apiKey : ""}
              onBlur={(event) => save({ apiKey: event.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <p>
            Leave the decision provider empty to use the first available provider’s fast text model.
          </p>
          <label>
            Decision provider instance
            <Input
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
          </label>
          <label>
            Decision model
            <Input
              defaultValue={config.modelSelection?.model ?? ""}
              disabled={!config.modelSelection}
              onBlur={(event) => {
                if (config.modelSelection && event.target.value.trim())
                  save({
                    modelSelection: { ...config.modelSelection, model: event.target.value.trim() },
                  });
              }}
            />
          </label>
        </>
      )}
      <label>
        Allowed environment IDs (comma separated; empty allows all)
        <Input
          defaultValue={config.allowedEnvironmentIds?.join(", ") ?? ""}
          onBlur={(event) =>
            save({
              allowedEnvironmentIds: event.target.value.trim() ? list(event.target.value) : null,
            })
          }
        />
      </label>
      <label>
        Allowed provider instance IDs (comma separated; empty allows all)
        <Input
          defaultValue={config.allowedProviderInstanceIds?.join(", ") ?? ""}
          onBlur={(event) =>
            save({
              allowedProviderInstanceIds: event.target.value.trim()
                ? list(event.target.value)
                : null,
            })
          }
        />
      </label>
      <p>
        Rules run from top to bottom. Restrict narrows the options; decide chooses the first
        remaining option and stops.
      </p>
      {config.rules.map((rule, index) => (
        <div key={rule.id}>
          <div className="flex items-center gap-2">
            <Switch
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
            <span>{rule.name}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={index === 0}
              onClick={() => {
                const rules = [...config.rules];
                [rules[index - 1], rules[index]] = [rules[index]!, rules[index - 1]!];
                save({ rules });
              }}
            >
              Move up
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save({ rules: config.rules.filter((entry) => entry.id !== rule.id) })}
            >
              Remove
            </Button>
          </div>
          <RuleEditor
            key={JSON.stringify(rule)}
            rule={rule}
            onSave={(next) =>
              save({ rules: config.rules.map((entry) => (entry.id === rule.id ? next : entry)) })
            }
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          save({
            rules: [
              ...config.rules,
              {
                id: `rule-${config.rules.reduce((next, rule) => Math.max(next, Number(rule.id.replace("rule-", "")) || 0), 0) + 1}`,
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
        Add rule
      </Button>
      <label>
        Project ID
        <Input value={projectId} onChange={(event) => setProjectId(event.target.value)} />
      </label>
      <label>
        Test a prompt
        <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <Button
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
      <pre aria-live="polite">{result}</pre>
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
    <div>
      <Textarea
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
      <p role="status">{error}</p>
    </div>
  );
}
