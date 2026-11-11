import { DEFAULT_TRAY_STATS } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  KeepAwakeChange,
  KeepAwakeDefaults,
  KeepAwakeSession,
  KeepAwakeStatus,
} from "@t3tools/contracts";
import { CoffeeIcon, SlashIcon } from "lucide-react";
import { useState } from "react";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { Radio, RadioGroup } from "./ui/radio-group";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

function keepAwakeLabel(status: KeepAwakeStatus) {
  if (!status.supported) return "Not supported";
  if (!status.active) return status.mode === "agents" ? "Waiting for agents" : "Off";
  if (status.mode === "agents") return `Awake · ${status.agents} agents`;
  return status.endsAt
    ? `Awake until ${new Date(status.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Awake indefinitely";
}

export function KeepAwakeControl({
  environmentId: provided,
  settings = false,
}: {
  environmentId?: EnvironmentId;
  settings?: boolean;
}) {
  const primary = usePrimaryEnvironmentId();
  const environmentId = provided ?? primary;
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.keepAwake({ environmentId, input: {} }) : null,
  );
  const allowed = useAtomValue(serverEnvironment.changeKeepAwake.permissionAtom(environmentId));
  const change = useAtomCommand(serverEnvironment.changeKeepAwake);
  const status = query.data;
  const send = (input: KeepAwakeChange) => {
    if (environmentId) void change({ environmentId, input });
  };
  if (settings)
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Keep awake</h3>
        {status && !status.supported ? (
          <p className="text-sm text-muted-foreground">
            Keep awake is not supported on this machine.
          </p>
        ) : status ? (
          <KeepAwakeForm status={status} disabled={!allowed} send={send} settings />
        ) : (
          <p>{query.error ?? "Connecting…"}</p>
        )}
      </section>
    );
  if (status && !status.supported) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label="Keep awake is not supported on this machine"
              className="relative inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground"
            />
          }
        >
          <CoffeeIcon className="size-4 opacity-50" />
          <SlashIcon className="absolute size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup>Keep awake is not supported on this machine</TooltipPopup>
      </Tooltip>
    );
  }
  const label = status ? keepAwakeLabel(status) : "Keep awake";
  return (
    <Tooltip>
      <Popover>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={`Keep awake: ${label}`} />}
            />
          }
        >
          <span className={status?.active ? "relative text-primary" : "text-muted-foreground"}>
            <CoffeeIcon className="size-4" />
            {status?.active ? (
              <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" />
            ) : null}
          </span>
        </TooltipTrigger>
        <PopoverPopup width="md" side="top">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Keep awake</h3>
            {status ? (
              <KeepAwakeForm status={status} disabled={!allowed} send={send} />
            ) : (
              <p>{query.error ?? "Connecting…"}</p>
            )}
          </div>
        </PopoverPopup>
      </Popover>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function KeepAwakeForm({
  status,
  disabled,
  send,
  settings = false,
}: {
  status: KeepAwakeStatus;
  disabled: boolean;
  send: (input: KeepAwakeChange) => void;
  settings?: boolean;
}) {
  const [minutes, setMinutes] = useState(60);
  const [until, setUntil] = useState("");
  const selected = settings ? status.defaults.mode : status.mode;
  const options = settings ? status.defaults.options : status.options;
  const saveDefaults = (patch: Partial<KeepAwakeDefaults>) =>
    send({ defaults: { ...status.defaults, ...patch } });
  const select = (mode: KeepAwakeSession["mode"]) => {
    if (settings) {
      saveDefaults({ mode });
      return;
    }
    if (mode === "duration") send({ session: { mode, minutes } });
    else if (mode === "until") {
      const endsAt = new Date(until).getTime();
      if (Number.isFinite(endsAt) && endsAt > Date.now()) send({ session: { mode, endsAt } });
    } else send({ session: { mode } });
  };
  const updateOptions = (patch: Partial<typeof options>) => {
    const next = { ...options, ...patch };
    if (settings) saveDefaults({ options: next });
    else send({ options: next });
  };
  return (
    <div className="space-y-3 text-sm">
      {settings ? (
        <fieldset className="space-y-2">
          <legend>Menu bar stats (this environment’s desktop)</legend>
          {(
            [
              ["enabled", "Show stats in the menu bar"],
              ["network", "Network speed"],
              ["cpu", "CPU"],
              ["memory", "Memory"],
              ["disk", "Disk"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <Checkbox
                disabled={disabled}
                checked={(status.defaults.trayStats ?? DEFAULT_TRAY_STATS)[key]}
                onCheckedChange={(checked) =>
                  saveDefaults({
                    trayStats: {
                      ...(status.defaults.trayStats ?? DEFAULT_TRAY_STATS),
                      [key]: checked,
                    },
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p role="status">{keepAwakeLabel(status)}</p>
      {status.reason ? <p className="text-xs text-muted-foreground">{status.reason}</p> : null}
      {settings ? (
        <p className="text-xs text-muted-foreground">
          Default session when this environment starts
        </p>
      ) : null}
      <RadioGroup
        value={selected}
        disabled={disabled || !status.supported}
        onValueChange={(value) => select(value as KeepAwakeSession["mode"])}
      >
        {(
          [
            ["off", "Off"],
            ["agents", "While agents are working"],
            ["duration", "For a duration"],
            ["until", "Until a specific time"],
            ["indefinite", "Indefinitely"],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-2">
            <Radio value={mode} />
            {label}
          </label>
        ))}
      </RadioGroup>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !status.supported}
          onClick={() => {
            setMinutes(60);
            if (settings) saveDefaults({ mode: "duration", durationMinutes: 60 });
            else send({ session: { mode: "duration", minutes: 60 } });
          }}
        >
          1 hour
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !status.supported}
          onClick={() => {
            setMinutes(240);
            if (settings) saveDefaults({ mode: "duration", durationMinutes: 240 });
            else send({ session: { mode: "duration", minutes: 240 } });
          }}
        >
          4 hours
        </Button>
      </div>
      <label className="block space-y-1">
        Custom duration (minutes)
        <Input
          type="number"
          min={1}
          max={10080}
          onBlur={(e) => {
            const value = Number(e.target.value);
            if (settings && value >= 1 && value <= 10080) saveDefaults({ durationMinutes: value });
          }}
          key={settings ? status.defaults.durationMinutes : "session-duration"}
          {...(settings ? { defaultValue: status.defaults.durationMinutes } : { value: minutes })}
          disabled={disabled}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (value >= 1 && value <= 10080) {
              setMinutes(value);
            }
          }}
        />
      </label>
      <label className="block space-y-1">
        {settings ? "Default end time (host local time)" : "End time (your local time)"}
        <Input
          type={settings ? "time" : "datetime-local"}
          key={settings ? status.defaults.untilTime : "session-until"}
          {...(settings ? { defaultValue: status.defaults.untilTime } : { value: until })}
          onBlur={(e) => {
            if (settings && /^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value))
              saveDefaults({ untilTime: e.target.value });
          }}
          disabled={disabled}
          onChange={(e) => {
            if (!settings) setUntil(e.target.value);
          }}
        />
      </label>
      {!settings ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !status.supported}
          onClick={() => select(until ? "until" : "duration")}
        >
          Start {until ? "until selected time" : "custom duration"}
        </Button>
      ) : null}
      <label className="flex items-center gap-2">
        <Checkbox
          disabled={disabled}
          checked={options.allowDisplaySleep}
          onCheckedChange={(checked) => updateOptions({ allowDisplaySleep: checked })}
        />
        Allow the display to sleep
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          disabled={disabled}
          checked={options.batteryCutoff !== null}
          onCheckedChange={(checked) => updateOptions({ batteryCutoff: checked ? 20 : null })}
        />
        Stop on low battery
      </label>
      {options.batteryCutoff !== null ? (
        <label className="block space-y-1">
          Battery threshold (%)
          <Input
            type="number"
            min={1}
            max={100}
            disabled={disabled}
            key={options.batteryCutoff}
            defaultValue={options.batteryCutoff}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (value >= 1 && value <= 100) updateOptions({ batteryCutoff: value });
            }}
          />
        </label>
      ) : null}
      <label className="flex items-start gap-2">
        <Checkbox
          disabled={disabled || !status.lidClosedSupported}
          checked={options.lidClosed}
          onCheckedChange={(checked) => updateOptions({ lidClosed: checked })}
        />
        Keep awake with lid closed (Mac: power + external display required)
      </label>
      <p className="text-xs text-muted-foreground">
        Controls the environment running your agents. macOS lid-close sleep cannot be overridden;
        use supported clamshell mode.
      </p>
    </div>
  );
}
