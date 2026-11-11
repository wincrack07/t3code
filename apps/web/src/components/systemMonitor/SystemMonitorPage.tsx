import {
  formatMachineBytes,
  formatMachinePercent,
  formatMachineRate,
  formatMachineUptime,
  presentMachineHealth,
  type MachineHealthLevel,
} from "@t3tools/client-runtime/state/machine-monitor";
import type {
  EnvironmentId,
  MachineMonitorSnapshot,
  MachineProcess,
  MachineProcessSnapshot,
  MachineSample,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useScopedSettings, useUpdateScopedSettings } from "../settings/useScopedSettings";
import { cn } from "../../lib/utils";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { MachineHistoryChart, type MachineHistoryMetric } from "./MachineHistoryChart";
import { MachineHealthDot, MachineShareBar } from "./MachineMeter";
import { useMachineMonitor } from "./useMachineMonitor";

const WINDOWS = [
  { label: "15 min", ms: 15 * 60_000 },
  { label: "1 h", ms: 60 * 60_000 },
  { label: "24 h", ms: 24 * 60 * 60_000 },
] as const;

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function SystemMonitorSettingsPanel() {
  const { environment } = useSettingsScope();
  // Window, sort and search belong to one machine, so a scope switch starts fresh.
  return <SystemMonitorBody key={environment?.environmentId ?? ""} />;
}

function SystemMonitorBody() {
  const { environment } = useSettingsScope();
  const id = environment?.environmentId ?? null;
  const connected = environment ? environment.connection.phase === "connected" : false;
  const { data, error, allowed } = useMachineMonitor(id, true);

  return (
    <SettingsPageContainer>
      <SettingsSection id="machine-monitor" title="Machine monitor">
        {environment === null ? (
          <Notice title="No environment selected">
            Connect an environment to see what its machine is doing
          </Notice>
        ) : !allowed ? (
          <Notice title="No access to this machine">
            This connection can’t read machine activity for {environment.label}
          </Notice>
        ) : data === null && error !== null ? (
          <Notice title="Monitor unavailable">{error}</Notice>
        ) : (
          <NowPanel snapshot={data} connected={connected} />
        )}
      </SettingsSection>
      {data ? (
        <>
          <HistorySection history={data.history} now={data.sample.at} />
          <UsageSection details={data.details} environmentId={id} />
        </>
      ) : null}
      <SidebarSettingSection />
    </SettingsPageContainer>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function NowPanel({
  snapshot,
  connected,
}: {
  snapshot: MachineMonitorSnapshot | null;
  connected: boolean;
}) {
  const sample = snapshot?.sample ?? null;
  const health = sample ? presentMachineHealth(sample) : null;
  const level = health && connected ? health.level : "unknown";
  const headline =
    health === null ? "Reading machine" : connected ? health.headline : "Disconnected";
  const alsoStrained = health?.reasons.slice(1).map((reason) => reason.label) ?? [];
  const detail =
    sample === null
      ? "Waiting for the first sample"
      : !connected
        ? `Showing the last sample, from ${clock(sample.at)}`
        : alsoStrained.length > 0
          ? `Also: ${alsoStrained.join(", ")}`
          : `Up ${formatMachineUptime(sample.uptime)} · sampled every 2 s`;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <MachineHealthDot level={level} />
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-medium text-foreground">{headline}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border/50 lg:grid-cols-4 [&>*]:border-border/50 max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r">
        <Stat
          label="CPU"
          value={formatMachinePercent(health?.cpu ?? null)}
          share={health?.cpu ?? null}
          level={health?.cpuLevel ?? "ok"}
          detail={sample ? `Load ${sample.load.map((v) => v.toFixed(2)).join(" · ")}` : null}
        />
        <Stat
          label="Memory"
          value={formatMachinePercent(health?.memory ?? null)}
          share={health?.memory ?? null}
          level={health?.memoryLevel ?? "ok"}
          detail={sample ? memoryDetail(sample) : null}
        />
        <Stat
          label="Disk"
          value={health?.disk == null ? "n/a" : `${formatMachinePercent(health.disk)} used`}
          share={health?.disk ?? null}
          level={health?.diskLevel ?? "ok"}
          detail={
            sample?.diskFree != null && sample.diskTotal !== null
              ? `${formatMachineBytes(sample.diskFree)} free of ${formatMachineBytes(sample.diskTotal)}`
              : sample
                ? "Not reported"
                : null
          }
        />
        <Stat
          label="Network"
          value={sample?.networkDown == null ? "n/a" : `↓ ${formatMachineRate(sample.networkDown)}`}
          detail={
            sample?.networkUp == null
              ? sample
                ? "Not reported yet"
                : null
              : `↑ ${formatMachineRate(sample.networkUp)} upload`
          }
        />
      </div>
      {snapshot && snapshot.limitations.length > 0 ? (
        <Limitations messages={snapshot.limitations} />
      ) : null}
    </div>
  );
}

function memoryDetail(sample: MachineSample) {
  const used = `${formatMachineBytes(sample.memoryUsed)} of ${formatMachineBytes(sample.memoryTotal)}`;
  return sample.swapUsed !== null && sample.swapTotal
    ? `${used} · swap ${formatMachineBytes(sample.swapUsed)}`
    : used;
}

function Stat(props: {
  label: string;
  value: string;
  share?: number | null;
  level?: MachineHealthLevel;
  detail: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 py-4">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span
        className={cn(
          "text-2xl leading-none font-medium tabular-nums",
          props.level === "strained"
            ? "text-destructive-foreground"
            : props.level === "busy"
              ? "text-warning-foreground"
              : "text-foreground",
        )}
      >
        {props.value}
      </span>
      {props.share === undefined ? (
        <span className="h-1.5" />
      ) : (
        <span className="flex">
          <MachineShareBar
            label={props.label}
            share={props.share}
            level={props.level ?? "ok"}
            detail={props.value}
          />
        </span>
      )}
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {props.detail ?? "n/a"}
      </span>
    </div>
  );
}

function Limitations({ messages }: { messages: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 px-4 py-3">
      {messages.map((message) => (
        <p key={message} className="flex items-start gap-2 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          {message}
        </p>
      ))}
    </div>
  );
}

function HistorySection({ history, now }: { history: readonly MachineSample[]; now: number }) {
  const [metric, setMetric] = useState<MachineHistoryMetric>("usage");
  const [windowMs, setWindowMs] = useState<number>(WINDOWS[0].ms);
  return (
    <SettingsSection
      title="Recent history"
      headerAction={
        <ToggleGroup
          aria-label="History window"
          value={[String(windowMs)]}
          onValueChange={(value) => {
            const next = Number(value[0]);
            if (Number.isFinite(next) && next > 0) setWindowMs(next);
          }}
        >
          {WINDOWS.map((option) => (
            <Toggle key={option.ms} value={String(option.ms)}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        <ToggleGroup
          aria-label="History metric"
          value={[metric]}
          onValueChange={(value) => {
            if (value[0] === "usage" || value[0] === "network") setMetric(value[0]);
          }}
        >
          <Toggle value="usage">CPU and memory</Toggle>
          <Toggle value="network">Network</Toggle>
        </ToggleGroup>
        <MachineHistoryChart history={history} metric={metric} windowMs={windowMs} now={now} />
      </div>
    </SettingsSection>
  );
}

type Sort = "memory" | "cpu";

function UsageSection({
  details,
  environmentId,
}: {
  details: MachineProcessSnapshot | undefined;
  environmentId: EnvironmentId | null;
}) {
  const [sort, setSort] = useState<Sort>("memory");
  const [search, setSearch] = useState("");
  return (
    <SettingsSection
      title="What’s using it"
      headerAction={
        details ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            Sampled {clock(details.sampledAt)} · every 10 s
          </span>
        ) : null
      }
    >
      {details === undefined ? (
        <Notice title="Sampling processes">
          The first process list arrives within a few seconds
        </Notice>
      ) : (
        <>
          <ProjectList details={details} environmentId={environmentId} />
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">Top processes</h3>
              <div className="flex items-center gap-2">
                <div className="w-48">
                  <Input
                    size="sm"
                    aria-label="Filter processes"
                    placeholder="Filter"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <ToggleGroup
                  aria-label="Sort processes"
                  value={[sort]}
                  onValueChange={(value) => {
                    if (value[0] === "memory" || value[0] === "cpu") setSort(value[0]);
                  }}
                >
                  <Toggle value="memory">Memory</Toggle>
                  <Toggle value="cpu">CPU</Toggle>
                </ToggleGroup>
              </div>
            </div>
            <ProcessList
              processes={sort === "memory" ? details.topMemory : details.topCpu}
              sort={sort}
              search={search}
              limitations={details.limitations}
            />
          </div>
        </>
      )}
    </SettingsSection>
  );
}

function ProjectList({
  details,
  environmentId,
}: {
  details: MachineProcessSnapshot;
  environmentId: EnvironmentId | null;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      <h3 className="text-sm font-medium text-foreground">T3 projects and threads</h3>
      {details.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No processes are running inside a T3 project right now
        </p>
      ) : (
        <ul className="flex flex-col">
          {details.projects.map((project) => (
            <li key={project.id} className="flex flex-col">
              <UsageRow
                name={project.title}
                meta={`${project.count} ${project.count === 1 ? "process" : "processes"}`}
                rss={project.rss}
                cpu={project.cpu}
              />
              {details.threads
                .filter((thread) => thread.projectId === project.id)
                .map((thread) => (
                  <UsageRow
                    key={thread.id}
                    indent
                    name={
                      environmentId ? (
                        <Link
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: thread.id }}
                          className="truncate rounded-sm text-foreground underline-offset-2 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        >
                          {thread.title}
                        </Link>
                      ) : (
                        thread.title
                      )
                    }
                    meta={
                      thread.attribution === "shared-directory"
                        ? "Shares the project folder, counted in the project total"
                        : `${thread.count ?? 0} ${thread.count === 1 ? "process" : "processes"}`
                    }
                    rss={thread.rss}
                    cpu={thread.cpu}
                  />
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UsageRow(props: {
  name: ReactNode;
  meta: string;
  rss: number | null;
  cpu: number | null;
  indent?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-3 rounded-md py-1.5 text-sm",
        props.indent && "pl-4",
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "truncate",
            props.indent ? "text-foreground" : "font-medium text-foreground",
          )}
        >
          {props.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{props.meta}</span>
      </span>
      <span className="text-right text-muted-foreground tabular-nums">
        {props.rss === null ? "" : formatMachineBytes(props.rss)}
      </span>
      <span className="text-right text-muted-foreground tabular-nums">
        {props.cpu === null ? "" : `${props.cpu.toFixed(1)}%`}
      </span>
    </div>
  );
}

function ProcessList(props: {
  processes: readonly MachineProcess[];
  sort: Sort;
  search: string;
  limitations: readonly string[];
}) {
  if (props.processes.length === 0) {
    return props.limitations.length > 0 ? (
      <Limitations messages={props.limitations} />
    ) : (
      <p className="text-sm text-muted-foreground">No processes reported</p>
    );
  }
  const query = props.search.trim().toLowerCase();
  const rows = props.processes.filter(
    (p) =>
      query === "" ||
      `${p.name} ${p.owner ?? ""} ${p.pid} ${p.cwd ?? ""}`.toLowerCase().includes(query),
  );
  const top = Math.max(1, ...props.processes.map((p) => (props.sort === "memory" ? p.rss : p.cpu)));
  const headClass = (column: Sort) =>
    column === props.sort ? "text-foreground" : "text-muted-foreground";
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_5rem_4rem] gap-3 border-b border-border/50 pb-2 text-xs">
        <span className="text-muted-foreground">Process</span>
        <span className="text-right text-muted-foreground">PID</span>
        <span className={cn("text-right", headClass("memory"))}>Memory</span>
        <span className={cn("text-right", headClass("cpu"))}>CPU</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No process matches “{props.search}”</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((p) => (
            <li
              key={p.pid}
              className="grid grid-cols-[minmax(0,1fr)_4rem_5rem_4rem] items-center gap-3 border-b border-border/30 py-1.5 text-sm last:border-0 hover:bg-muted/40"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-foreground">
                  {p.name}
                  {p.owner ? <span className="text-muted-foreground"> · {p.owner}</span> : null}
                  {p.cwd ? (
                    <span className="text-xs text-muted-foreground">
                      {"  "}
                      {p.cwd}
                    </span>
                  ) : null}
                </span>
                <span className="flex">
                  <MachineShareBar
                    label={`${p.name} ${props.sort}`}
                    share={(props.sort === "memory" ? p.rss : p.cpu) / top}
                    level="ok"
                    detail={
                      props.sort === "memory" ? formatMachineBytes(p.rss) : `${p.cpu.toFixed(1)}%`
                    }
                  />
                </span>
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {p.pid}
              </span>
              <span className={cn("text-right tabular-nums", headClass("memory"))}>
                {formatMachineBytes(p.rss)}
              </span>
              <span className={cn("text-right tabular-nums", headClass("cpu"))}>
                {p.cpu.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-3 text-xs text-muted-foreground">
        Top 30 by {props.sort === "memory" ? "memory" : "CPU"}. CPU can pass 100% on multi-core
        machines. {props.limitations.join(" ")}
      </p>
    </div>
  );
}

function SidebarSettingSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection id="system-monitor" title="Sidebar">
      <SettingsRow
        title="Show machine health in the sidebar"
        description="Adds a health dot to the monitor icon and the live numbers to its tooltip. Off, the icon only opens this page."
        control={
          <Switch
            checked={settings.showSystemMonitor}
            onCheckedChange={(checked) => updateSettings({ showSystemMonitor: checked })}
            aria-label="Show machine health in the sidebar"
          />
        }
      />
    </SettingsSection>
  );
}
