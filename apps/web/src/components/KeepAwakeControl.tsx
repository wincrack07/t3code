import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  KeepAwakeChange,
  KeepAwakeDefaults,
  KeepAwakeSession,
  KeepAwakeStatus,
} from "@t3tools/contracts";
import { CoffeeIcon } from "lucide-react";
import { useState } from "react";
import { isElectron } from "../env";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "./ui/select";
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
} from "./ui/number-field";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { Radio, RadioGroup } from "./ui/radio-group";

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
  pill = false,
  settings = false,
}: {
  environmentId?: EnvironmentId;
  pill?: boolean;
  settings?: boolean;
}) {
  const primary = usePrimaryEnvironmentId();
  const environmentId = provided ?? primary;
  const environment = useEnvironment(environmentId);
  const target = environment?.entry.target;
  const localDesktop =
    isElectron &&
    (target?._tag === "PrimaryConnectionTarget" ||
      (target?._tag === "BearerConnectionTarget" && target.connectionId.startsWith("platform:")));
  const authorize = useAtomCommand(serverEnvironment.authorizeKeepAwakeLid);
  const authorizeAllowed = useAtomValue(
    serverEnvironment.authorizeKeepAwakeLid.permissionAtom(environmentId),
  );
  const authorizeLid = (action: "install" | "remove" | "refresh") => {
    if (environmentId) void authorize({ environmentId, input: { action } });
  };
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
        {status ? (
          <KeepAwakeForm
            key={environmentId}
            status={status}
            disabled={!allowed}
            send={send}
            authorize={authorizeLid}
            localDesktop={localDesktop && authorizeAllowed}
            settings
          />
        ) : (
          <p>{query.error ?? "Connecting…"}</p>
        )}
      </section>
    );
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size={pill ? "sm" : "icon"} aria-label="Keep awake" />}
      >
        <span className={status?.active ? "relative text-primary" : "text-muted-foreground"}>
          <CoffeeIcon className="size-4" />
          {status?.active ? (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" />
          ) : null}
        </span>
        {pill ? (status ? keepAwakeLabel(status) : "Keep awake") : null}
      </PopoverTrigger>
      <PopoverPopup width="md" side="top">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Keep awake</h3>
          {status ? (
            <KeepAwakeForm
              key={environmentId}
              status={status}
              disabled={!allowed}
              send={send}
              authorize={authorizeLid}
              localDesktop={localDesktop && authorizeAllowed}
            />
          ) : (
            <p>{query.error ?? "Connecting…"}</p>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const modes = [
  ["off", "Off"],
  ["agents", "While agents are working"],
  ["duration", "For a duration"],
  ["until", "Until a specific time"],
  ["indefinite", "Indefinitely"],
] as const;

function KeepAwakeForm({
  status,
  disabled,
  send,
  settings = false,
  authorize,
  localDesktop,
}: {
  status: KeepAwakeStatus;
  disabled: boolean;
  send: (input: KeepAwakeChange) => void;
  settings?: boolean;
  authorize: (action: "install" | "remove" | "refresh") => void;
  localDesktop: boolean;
}) {
  const [mode, setMode] = useState<KeepAwakeSession["mode"]>(
    settings ? status.defaults.mode : status.mode,
  );
  const [minutes, setMinutes] = useState(status.defaults.durationMinutes);
  const [untilError, setUntilError] = useState(false);
  const [day, setDay] = useState("today");
  const [hour, setHour] = useState(String(Number(status.defaults.untilTime.split(":")[0])));
  const [minute, setMinute] = useState(status.defaults.untilTime.split(":")[1] ?? "00");
  const options = settings ? status.defaults.options : status.options;
  const saveDefaults = (patch: Partial<KeepAwakeDefaults>) =>
    send({ defaults: { ...status.defaults, ...patch } });
  const updateOptions = (patch: Partial<typeof options>) => {
    const next = { ...options, ...patch };
    if (settings) saveDefaults({ options: next });
    else send({ options: next });
  };
  const choose = (value: KeepAwakeSession["mode"]) => {
    setMode(value);
    if (settings) saveDefaults({ mode: value });
    else if (value !== "duration" && value !== "until") send({ session: { mode: value } });
  };
  const start = () => {
    if (mode === "duration") send({ session: { mode, minutes } });
    else if (mode === "until") {
      const date = new Date();
      date.setHours(Number(hour), Number(minute), 0, 0);
      if (day === "tomorrow") date.setDate(date.getDate() + 1);
      const valid = date.getTime() > Date.now();
      setUntilError(!valid);
      if (valid) send({ session: { mode, endsAt: date.getTime() } });
    }
  };
  const lid = status.lid;
  const locked = disabled || !status.supported;
  return (
    <div className="space-y-4 text-sm">
      <p role="status" className="font-medium">
        {keepAwakeLabel(status)}
      </p>
      {status.reason ? (
        <p role="alert" className="text-xs text-muted-foreground">
          {status.reason}
        </p>
      ) : null}
      <section className="space-y-3" aria-label={settings ? "Default session" : "Session"}>
        {settings ? <p className="text-xs text-muted-foreground">Default session</p> : null}
        <RadioGroup
          value={mode}
          disabled={locked}
          onValueChange={(value) => choose(value as KeepAwakeSession["mode"])}
        >
          {modes.map(([value, label]) => (
            <label key={value} className="flex min-h-8 items-center gap-3">
              <Radio value={value} />
              {label}
            </label>
          ))}
        </RadioGroup>
        {mode === "duration" ? (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex gap-2">
              {[60, 240].map((value) => (
                <Button
                  key={value}
                  variant={minutes === value ? "secondary" : "outline"}
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    setMinutes(value);
                    if (settings) saveDefaults({ durationMinutes: value });
                  }}
                >
                  {value / 60} {value === 60 ? "hour" : "hours"}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Minutes</span>
              <div className="w-36">
                <NumberField
                  size="sm"
                  min={1}
                  max={10080}
                  value={minutes}
                  disabled={locked}
                  onValueChange={(value) => {
                    if (value !== null) {
                      setMinutes(value);
                      if (settings) saveDefaults({ durationMinutes: value });
                    }
                  }}
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement />
                    <NumberFieldInput aria-label="Duration in minutes" />
                    <NumberFieldIncrement />
                  </NumberFieldGroup>
                </NumberField>
              </div>
            </div>
          </div>
        ) : null}
        {mode === "until" ? (
          <div className="space-y-3 border-t border-border pt-3">
            {!settings ? (
              <Select
                value={day}
                onValueChange={(value) => {
                  if (value) {
                    setDay(value);
                    setUntilError(false);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="End day">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="tomorrow">Tomorrow</SelectItem>
                </SelectPopup>
              </Select>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="flex-1">{settings ? "End time" : "Until"}</span>
              <Select
                value={hour}
                onValueChange={(value) => {
                  if (value) {
                    setUntilError(false);
                    setHour(value);
                    if (settings)
                      saveDefaults({ untilTime: `${value.padStart(2, "0")}:${minute}` });
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="End hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <span>:</span>
              <Select
                value={minute}
                onValueChange={(value) => {
                  if (value) {
                    setUntilError(false);
                    setMinute(value);
                    if (settings) saveDefaults({ untilTime: `${hour.padStart(2, "0")}:${value}` });
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="End minute">
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
          </div>
        ) : null}
        {!settings && mode === "until" && untilError ? (
          <p className="text-xs text-muted-foreground">Choose a later time or Tomorrow</p>
        ) : null}
        {!settings && (mode === "duration" || mode === "until") ? (
          <Button size="sm" disabled={locked} onClick={start}>
            Start session
          </Button>
        ) : null}
      </section>
      <section className="space-y-3 border-t border-border pt-4" aria-label="Options">
        <label className="flex min-h-8 items-center justify-between gap-4">
          <span>Allow display sleep</span>
          <Switch
            disabled={disabled}
            checked={options.allowDisplaySleep}
            onCheckedChange={(checked) => updateOptions({ allowDisplaySleep: checked })}
          />
        </label>
        <label className="flex min-h-8 items-center justify-between gap-4">
          <span>Stop on low battery</span>
          <Switch
            disabled={disabled}
            checked={options.batteryCutoff !== null}
            onCheckedChange={(checked) => updateOptions({ batteryCutoff: checked ? 20 : null })}
          />
        </label>
        {options.batteryCutoff !== null ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Below (%)</span>
            <div className="w-36">
              <NumberField
                key={options.batteryCutoff}
                size="sm"
                min={1}
                max={100}
                defaultValue={options.batteryCutoff}
                disabled={disabled}
                onValueCommitted={(value) => {
                  if (value !== null) updateOptions({ batteryCutoff: value });
                }}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput aria-label="Battery threshold percent" />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </div>
          </div>
        ) : null}
        {status.lidClosedSupported ? (
          <div className="space-y-2">
            <label className="flex min-h-8 items-center justify-between gap-4">
              <span>Keep awake with lid closed</span>
              <Switch
                disabled={disabled || !lid?.authorized}
                checked={options.lidClosed}
                onCheckedChange={(checked) => updateOptions({ lidClosed: checked })}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              A closed laptop stays warm and drains battery; Stop on low battery still applies.
            </p>
            {lid ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {lid.active
                      ? "Active"
                      : lid.authorized
                        ? "Authorized"
                        : "Authorization required"}
                  </span>
                  {localDesktop && lid.nativeAuthorization ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => authorize(lid.authorized ? "remove" : "install")}
                    >
                      {lid.authorized ? "Remove authorization" : "Authorize"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => authorize("refresh")}
                    >
                      Check authorization
                    </Button>
                  )}
                </div>
                {!localDesktop || !lid.nativeAuthorization ? (
                  <details className="text-xs">
                    <summary>Run on this Mac</summary>
                    <div className="mt-2 space-y-2">
                      <p>Authorize</p>
                      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {lid.installCommand}
                      </pre>
                      <p>Remove authorization after ending lid-closed sessions</p>
                      <pre className="overflow-auto rounded-md bg-muted p-2 text-xs">
                        {lid.removeCommand}
                      </pre>
                    </div>
                  </details>
                ) : null}
                {lid.error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {lid.error}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
