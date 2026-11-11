import {
  DEFAULT_TRAY_STATS,
  type KeepAwakeChange,
  type KeepAwakeDefaults,
  type KeepAwakeStatus,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
} from "../ui/number-field";
import { SettingsRow } from "./settingsLayout";

export function KeepAwakeSettingsFields({
  status,
  disabled,
  send,
  authorize,
  localDesktop,
}: {
  status: KeepAwakeStatus;
  disabled: boolean;
  send: (input: KeepAwakeChange) => void;
  authorize: (action: "install" | "remove" | "refresh") => void;
  localDesktop: boolean;
}) {
  const defaults = status.defaults;
  const options = status.options;
  const save = (patch: Partial<KeepAwakeDefaults>) => send({ defaults: { ...defaults, ...patch } });
  const updateOptions = (patch: Partial<typeof options>) => {
    const next = { ...options, ...patch };
    send({ defaults: { ...defaults, options: next }, options: next });
  };
  const lid = status.lid;
  const stats = defaults.trayStats ?? DEFAULT_TRAY_STATS;
  const [hour = "18", minute = "00"] = defaults.untilTime.split(":");
  const authorization =
    lid?.error ??
    (lid?.active ? "Active" : lid?.authorized ? "Authorized" : "Authorization required");
  return (
    <div>
      <SettingsRow
        title="Default session"
        description="When this environment starts"
        control={
          <Select
            value={defaults.mode}
            onValueChange={(mode) => {
              if (mode) save({ mode: mode as KeepAwakeDefaults["mode"] });
            }}
          >
            <SelectTrigger size="sm" disabled={disabled} aria-label="Default keep-awake session">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {(
                [
                  ["off", "Off"],
                  ["agents", "While agents are working"],
                  ["duration", "For a duration"],
                  ["until", "Until a specific time"],
                  ["indefinite", "Indefinitely"],
                ] as const
              ).map(([value, label]) => (
                <SelectItem key={value} value={value}>
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
          description="Minutes"
          control={
            <div className="w-36">
              <NumberField
                size="sm"
                min={1}
                max={10080}
                key={defaults.durationMinutes}
                defaultValue={defaults.durationMinutes}
                disabled={disabled}
                onValueCommitted={(value) => {
                  if (value !== null) save({ durationMinutes: value });
                }}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput aria-label="Default duration in minutes" />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </div>
          }
        />
      ) : null}
      {defaults.mode === "until" ? (
        <SettingsRow
          title="End time"
          description="The next occurrence in this machine’s local time"
          control={
            <div className="flex items-center gap-2">
              <Select
                value={hour}
                onValueChange={(value) => {
                  if (value) save({ untilTime: `${value}:${minute}` });
                }}
              >
                <SelectTrigger size="sm" disabled={disabled} aria-label="Default end hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h).padStart(2, "0")}>
                      {String(h).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <span>:</span>
              <Select
                value={minute}
                onValueChange={(value) => {
                  if (value) save({ untilTime: `${hour}:${value}` });
                }}
              >
                <SelectTrigger size="sm" disabled={disabled} aria-label="Default end minute">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {Array.from({ length: 60 }, (_, m) => (
                    <SelectItem key={m} value={String(m).padStart(2, "0")}>
                      {String(m).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />
      ) : null}
      <SettingsRow
        title="Allow display sleep"
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
          description="Stop at or below this percentage"
          control={
            <div className="w-36">
              <NumberField
                size="sm"
                min={1}
                max={100}
                key={options.batteryCutoff}
                defaultValue={options.batteryCutoff}
                disabled={disabled}
                onValueCommitted={(value) => {
                  if (value !== null) updateOptions({ batteryCutoff: value });
                }}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput aria-label="Default battery threshold percent" />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </div>
          }
        />
      ) : null}
      {status.lidClosedSupported ? (
        <>
          <SettingsRow
            title="Keep awake with lid closed"
            description="A closed laptop stays warm and drains battery; Stop on low battery still applies."
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
            title="Lid-closed authorization"
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
              <details className="mt-3 text-xs">
                <summary>Run on this Mac</summary>
                <div className="mt-2 space-y-2">
                  <p>Authorize</p>
                  <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2">
                    {lid.installCommand}
                  </pre>
                  <p>Remove authorization after ending lid-closed sessions</p>
                  <pre className="overflow-auto rounded-md bg-muted p-2">{lid.removeCommand}</pre>
                </div>
              </details>
            ) : null}
          </SettingsRow>
        </>
      ) : null}
      <SettingsRow
        title="Show stats in the menu bar"
        control={
          <Switch
            disabled={disabled}
            aria-label="Show stats in the menu bar"
            checked={stats.enabled}
            onCheckedChange={(enabled) => save({ trayStats: { ...stats, enabled } })}
          />
        }
      />
      {stats.enabled
        ? (
            [
              ["network", "Network speed"],
              ["cpu", "CPU"],
              ["memory", "Memory"],
              ["disk", "Disk"],
            ] as const
          ).map(([key, label]) => (
            <SettingsRow
              key={key}
              title={label}
              control={
                <Switch
                  disabled={disabled}
                  aria-label={label}
                  checked={stats[key]}
                  onCheckedChange={(checked) => save({ trayStats: { ...stats, [key]: checked } })}
                />
              }
            />
          ))
        : null}
    </div>
  );
}
