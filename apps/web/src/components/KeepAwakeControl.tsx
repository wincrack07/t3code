import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  KeepAwakeChange,
  KeepAwakeSession,
  KeepAwakeStatus,
} from "@t3tools/contracts";
import { ChevronDownIcon, CoffeeIcon, SlashIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { isElectron } from "../env";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
} from "./ui/number-field";
import { KEEP_AWAKE_MODES, keepAwakeTimeOptions } from "./settings/KeepAwakeSettingsFields";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

function keepAwakeLabel(status: KeepAwakeStatus) {
  if (!status.supported) return "Not supported";
  if (!status.active) return status.mode === "agents" ? "Waiting for agents" : "Off";
  if (status.mode === "agents") return `Awake · ${status.agents} agents`;
  return status.endsAt
    ? `Awake until ${new Date(status.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Awake indefinitely";
}

/** Keep-awake state and actions for one environment, shared by the popover and Settings. */
export function useKeepAwake(provided?: EnvironmentId) {
  const primary = usePrimaryEnvironmentId();
  const environmentId = provided ?? primary;
  const environment = useEnvironment(environmentId);
  const target = environment?.entry.target;
  const localDesktop =
    isElectron &&
    (target?._tag === "PrimaryConnectionTarget" ||
      (target?._tag === "BearerConnectionTarget" && target.connectionId.startsWith("platform:")));
  const authorizeCommand = useAtomCommand(serverEnvironment.authorizeKeepAwakeLid);
  const authorizeAllowed = useAtomValue(
    serverEnvironment.authorizeKeepAwakeLid.permissionAtom(environmentId),
  );
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.keepAwake({ environmentId, input: {} }) : null,
  );
  const allowed = useAtomValue(serverEnvironment.changeKeepAwake.permissionAtom(environmentId));
  const change = useAtomCommand(serverEnvironment.changeKeepAwake);
  return {
    environmentId,
    status: query.data,
    error: query.error,
    disabled: !allowed,
    localDesktop: localDesktop && authorizeAllowed,
    send: (input: KeepAwakeChange) => {
      if (environmentId) void change({ environmentId, input });
    },
    authorize: (action: "install" | "remove" | "refresh") => {
      if (environmentId) void authorizeCommand({ environmentId, input: { action } });
    },
  };
}

export function KeepAwakeControl({ environmentId: provided }: { environmentId?: EnvironmentId }) {
  const { environmentId, status, error, disabled, localDesktop, send, authorize } =
    useKeepAwake(provided);
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
          {status ? (
            <KeepAwakeForm
              key={environmentId}
              status={status}
              disabled={disabled}
              send={send}
              authorize={authorize}
              localDesktop={localDesktop}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{error ?? "Connecting…"}</p>
          )}
        </PopoverPopup>
      </Popover>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function FormRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <span className="min-w-0 text-sm">{label}</span>
      {children}
    </div>
  );
}

/** Off, agents and indefinite apply at once; a duration or an end time waits for Start. */
type PendingMode = Extract<KeepAwakeSession["mode"], "duration" | "until">;

export function KeepAwakeForm({
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
  const [pending, setPending] = useState<PendingMode | null>(null);
  const [minutes, setMinutes] = useState(status.defaults.durationMinutes);
  const [day, setDay] = useState("today");
  const [time, setTime] = useState(status.defaults.untilTime);
  const [untilError, setUntilError] = useState(false);
  // The picker shows what is running unless a timed session is being set up.
  const running: KeepAwakeSession["mode"] =
    status.active || status.mode === "agents" ? status.mode : "off";
  const mode = pending ?? running;
  const options = status.options;
  const updateOptions = (patch: Partial<typeof options>) =>
    send({ options: { ...options, ...patch } });
  const choose = (value: KeepAwakeSession["mode"]) => {
    setUntilError(false);
    if (value === "duration" || value === "until") setPending(value);
    else {
      setPending(null);
      send({ session: { mode: value } });
    }
  };
  const start = () => {
    if (pending === "duration") {
      send({ session: { mode: "duration", minutes } });
      setPending(null);
    } else if (pending === "until") {
      const [hour = "0", minute = "0"] = time.split(":");
      const date = new Date();
      date.setHours(Number(hour), Number(minute), 0, 0);
      if (day === "tomorrow") date.setDate(date.getDate() + 1);
      const valid = date.getTime() > Date.now();
      setUntilError(!valid);
      if (valid) {
        send({ session: { mode: "until", endsAt: date.getTime() } });
        setPending(null);
      }
    }
  };
  const lid = status.lid;
  const locked = disabled || !status.supported;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">Keep awake</h3>
        <p role="status" className="text-xs text-muted-foreground">
          {pending ? "Off until you start" : keepAwakeLabel(status)}
        </p>
        {status.reason ? (
          <p role="alert" className="text-xs text-muted-foreground">
            {status.reason}
          </p>
        ) : null}
      </div>
      <section className="flex flex-col gap-2" aria-label="Session">
        <FormRow label="Session">
          <Select
            value={mode}
            onValueChange={(value) => {
              if (value) choose(value as KeepAwakeSession["mode"]);
            }}
          >
            <SelectTrigger size="sm" className="w-44" disabled={locked} aria-label="Session">
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
        </FormRow>
        {pending === "duration" ? (
          <FormRow label="Minutes">
            <div className="w-44">
              <NumberField
                size="sm"
                min={1}
                max={10080}
                value={minutes}
                disabled={locked}
                onValueChange={(value) => {
                  if (value !== null) setMinutes(value);
                }}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput aria-label="Duration in minutes" />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </div>
          </FormRow>
        ) : null}
        {pending === "until" ? (
          <FormRow label="Until">
            <div className="flex w-44 gap-2">
              <Select
                value={day}
                onValueChange={(value) => {
                  if (value) {
                    setDay(value);
                    setUntilError(false);
                  }
                }}
              >
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="End day">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="today">
                    Today
                  </SelectItem>
                  <SelectItem hideIndicator value="tomorrow">
                    Tomorrow
                  </SelectItem>
                </SelectPopup>
              </Select>
              <Select
                value={time}
                onValueChange={(value) => {
                  if (value) {
                    setTime(value);
                    setUntilError(false);
                  }
                }}
              >
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="End time">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {keepAwakeTimeOptions(time).map((option) => (
                    <SelectItem hideIndicator key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </FormRow>
        ) : null}
        {untilError ? (
          <p className="text-xs text-muted-foreground">Choose a later time or tomorrow</p>
        ) : null}
        {pending ? (
          <Button size="sm" className="self-end" disabled={locked} onClick={start}>
            Start session
          </Button>
        ) : null}
      </section>
      <section className="flex flex-col gap-2 border-t border-border pt-4" aria-label="Options">
        <FormRow label="Allow display sleep">
          <Switch
            disabled={disabled}
            aria-label="Allow display sleep"
            checked={options.allowDisplaySleep}
            onCheckedChange={(checked) => updateOptions({ allowDisplaySleep: checked })}
          />
        </FormRow>
        <FormRow label="Stop on low battery">
          <Switch
            disabled={disabled}
            aria-label="Stop on low battery"
            checked={options.batteryCutoff !== null}
            onCheckedChange={(checked) => updateOptions({ batteryCutoff: checked ? 20 : null })}
          />
        </FormRow>
        {options.batteryCutoff !== null ? (
          <FormRow label={<span className="text-muted-foreground">Stop at (%)</span>}>
            <div className="w-44">
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
          </FormRow>
        ) : null}
        {status.lidClosedSupported ? (
          <>
            <FormRow label="Keep awake with lid closed">
              <Switch
                disabled={disabled || (!lid?.authorized && !options.lidClosed)}
                aria-label="Keep awake with lid closed"
                checked={options.lidClosed}
                onCheckedChange={(checked) => updateOptions({ lidClosed: checked })}
              />
            </FormRow>
            {lid ? (
              <>
                <FormRow
                  label={
                    <span className="text-xs text-muted-foreground">
                      {lid.active
                        ? "Active"
                        : lid.authorized
                          ? "Authorized"
                          : "Needs authorization"}
                    </span>
                  }
                >
                  {localDesktop && lid.nativeAuthorization ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => authorize(lid.authorized ? "remove" : "install")}
                    >
                      {lid.authorized ? "Remove authorization" : "Authorize"}
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => authorize("refresh")}
                    >
                      Check authorization
                    </Button>
                  )}
                </FormRow>
                {!localDesktop || !lid.nativeAuthorization ? (
                  <Collapsible>
                    <CollapsibleTrigger
                      render={<Button size="xs" variant="ghost-muted" className="group -ms-2" />}
                    >
                      Commands to run on this Mac
                      <ChevronDownIcon className="transition-transform group-data-panel-open:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <div className="flex flex-col gap-2 pt-2 text-xs text-muted-foreground">
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
                {lid.error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {lid.error}
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
