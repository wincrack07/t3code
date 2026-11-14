import {
  DEFAULT_TRAY_STATS,
  type KeepAwakeChange,
  type KeepAwakeDefaults,
  type KeepAwakeStatus,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

export const KEEP_AWAKE_MODES = [
  ["off", "Off"],
  ["agents", "While agents work"],
  ["duration", "For a duration"],
  ["until", "Until a time"],
  ["indefinite", "Indefinitely"],
] as const;

/** Quarter-hour times, plus `current` when it falls between them. */
export function keepAwakeTimeOptions(current: string): string[] {
  const times = Array.from(
    { length: 96 },
    (_, slot) =>
      `${String(Math.floor(slot / 4)).padStart(2, "0")}:${String((slot % 4) * 15).padStart(2, "0")}`,
  );
  return times.includes(current) ? times : [...times, current].toSorted();
}

interface KeepAwakeFieldsProps {
  status: KeepAwakeStatus;
  disabled: boolean;
  send: (input: KeepAwakeChange) => void;
  authorize: (action: "install" | "remove" | "refresh") => void;
  localDesktop: boolean;
}

function NumberControl({
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="w-full sm:w-36">
      <NumberField
        size="sm"
        min={min}
        max={max}
        key={value}
        defaultValue={value}
        disabled={disabled}
        onValueCommitted={(next) => {
          if (next !== null) onCommit(next);
        }}
      >
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput aria-label={label} />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>
    </div>
  );
}

/** The defaults an environment applies when it starts, as Settings rows. */
export function KeepAwakeSettingsFields({
  status,
  disabled,
  send,
  authorize,
  localDesktop,
}: KeepAwakeFieldsProps) {
  const defaults = status.defaults;
  const options = status.options;
  const save = (patch: Partial<KeepAwakeDefaults>) => send({ defaults: { ...defaults, ...patch } });
  const updateOptions = (patch: Partial<typeof options>) => {
    const next = { ...options, ...patch };
    send({ defaults: { ...defaults, options: next }, options: next });
  };
  const lid = status.lid;
  const authorization =
    lid?.error ??
    (lid?.active ? "Active" : lid?.authorized ? "Authorized" : "Authorization required");
  return (
    <>
      <SettingsRow
        title="Default session"
        description="Starts when this environment starts."
        control={
          <Select
            value={defaults.mode}
            onValueChange={(mode) => {
              if (mode) save({ mode: mode as KeepAwakeDefaults["mode"] });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              disabled={disabled}
              aria-label="Default keep-awake session"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {KEEP_AWAKE_MODES.map(([value, label]) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {defaults.mode === "duration" ? (
        <SettingsRow
          title="Duration"
          description="In minutes."
          control={
            <NumberControl
              label="Default duration in minutes"
              value={defaults.durationMinutes}
              min={1}
              max={10080}
              disabled={disabled}
              onCommit={(durationMinutes) => save({ durationMinutes })}
            />
          }
        />
      ) : null}
      {defaults.mode === "until" ? (
        <SettingsRow
          title="End time"
          description="The next time it comes round, in this machine's time zone."
          control={
            <Select
              value={defaults.untilTime}
              onValueChange={(untilTime) => {
                if (untilTime) save({ untilTime });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                disabled={disabled}
                aria-label="Default end time"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {keepAwakeTimeOptions(defaults.untilTime).map((time) => (
                  <SelectItem hideIndicator key={time} value={time}>
                    {time}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      <SettingsRow
        title="Allow display sleep"
        description="Keep the machine awake but let the screen turn off."
        control={
          <Switch
            disabled={disabled}
            aria-label="Allow display sleep"
            checked={options.allowDisplaySleep}
            onCheckedChange={(checked) => updateOptions({ allowDisplaySleep: checked })}
          />
        }
      />
      <SettingsRow
        title="Stop on low battery"
        control={
          <Switch
            disabled={disabled}
            aria-label="Stop on low battery"
            checked={options.batteryCutoff !== null}
            onCheckedChange={(checked) => updateOptions({ batteryCutoff: checked ? 20 : null })}
          />
        }
      />
      {options.batteryCutoff !== null ? (
        <SettingsRow
          title="Battery threshold"
          description="Stops at or below this percentage."
          control={
            <NumberControl
              label="Default battery threshold percent"
              value={options.batteryCutoff}
              min={1}
              max={100}
              disabled={disabled}
              onCommit={(batteryCutoff) => updateOptions({ batteryCutoff })}
            />
          }
        />
      ) : null}
      {status.lidClosedSupported ? (
        <>
          <SettingsRow
            title="Keep awake with lid closed"
            description="A closed laptop stays warm and uses battery. Stop on low battery still applies."
            control={
              <Switch
                disabled={disabled || (!lid?.authorized && !options.lidClosed)}
                aria-label="Keep awake with lid closed"
                checked={options.lidClosed}
                onCheckedChange={(checked) => updateOptions({ lidClosed: checked })}
              />
            }
          />
          <SettingsRow
            title="Lid-closed permission"
            description={authorization}
            control={
              localDesktop && lid?.nativeAuthorization ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => authorize(lid.authorized ? "remove" : "install")}
                >
                  {lid.authorized ? "Remove authorization" : "Authorize"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => authorize("refresh")}
                >
                  Check authorization
                </Button>
              )
            }
          >
            {lid && (!localDesktop || !lid.nativeAuthorization) ? (
              <Collapsible className="pb-3">
                <CollapsibleTrigger
                  render={<Button size="xs" variant="ghost-muted" className="group -ms-2" />}
                >
                  Commands to run on this Mac
                  <ChevronDownIcon className="transition-transform group-data-panel-open:rotate-180" />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="flex max-w-2xl flex-col gap-2 pt-2 text-xs text-muted-foreground">
                    <p>Authorize</p>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 font-mono text-foreground">
                      {lid.installCommand}
                    </pre>
                    <p>Remove, after ending lid-closed sessions</p>
                    <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-foreground">
                      {lid.removeCommand}
                    </pre>
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            ) : null}
          </SettingsRow>
        </>
      ) : null}
    </>
  );
}

const TRAY_STATS = [
  ["network", "Network speed"],
  ["cpu", "CPU"],
  ["memory", "Memory"],
  ["disk", "Disk"],
] as const;

/** Which stats the desktop app shows beside its menu bar icon. */
export function KeepAwakeTrayStatsFields({
  status,
  disabled,
  send,
}: Pick<KeepAwakeFieldsProps, "status" | "disabled" | "send">) {
  const defaults = status.defaults;
  const stats = defaults.trayStats ?? DEFAULT_TRAY_STATS;
  const save = (trayStats: typeof stats) => send({ defaults: { ...defaults, trayStats } });
  return (
    <>
      <SettingsRow
        title="Show stats in the menu bar"
        control={
          <Switch
            disabled={disabled}
            aria-label="Show stats in the menu bar"
            checked={stats.enabled}
            onCheckedChange={(enabled) => save({ ...stats, enabled })}
          />
        }
      />
      {stats.enabled
        ? TRAY_STATS.map(([key, label]) => (
            <SettingsRow
              key={key}
              title={label}
              control={
                <Switch
                  disabled={disabled}
                  aria-label={label}
                  checked={stats[key]}
                  onCheckedChange={(checked) => save({ ...stats, [key]: checked })}
                />
              }
            />
          ))
        : null}
    </>
  );
}
