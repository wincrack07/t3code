import type { EnvironmentId, MachineSample } from "@t3tools/contracts";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useClientSettings } from "../hooks/useSettings";
import { usePrimaryEnvironmentId, useEnvironments } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const bytes = (value: number | null) =>
  value === null ? "Unavailable" : `${(value / 1024 ** 3).toFixed(1)} GB`;
const rate = (value: number | null) =>
  value === null ? "N/A" : `${(value / 1024).toFixed(0)} KB/s`;
function useMonitor(id: EnvironmentId | null) {
  const allowed = useEnvironmentScope(id, AuthOrchestrationReadScope);
  return useEnvironmentQuery(
    id && allowed ? serverEnvironment.machineMonitor({ environmentId: id, input: {} }) : null,
  );
}

export function SystemMonitorIndicator() {
  const enabled = useClientSettings((s) => s.showSystemMonitor);
  return enabled ? <MonitorIndicator /> : null;
}
function MonitorIndicator() {
  const id = usePrimaryEnvironmentId();
  const { data, error } = useMonitor(id);
  const navigate = useNavigate();
  const s = data?.sample;
  const warning =
    s &&
    (s.pressure === "warning" ||
      s.pressure === "critical" ||
      (s.diskFree !== null && s.diskFree < 10 * 1024 ** 3));
  return (
    <div className={warning ? "text-warning" : "text-muted-foreground"}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void navigate({ to: "/settings/general" })}
        aria-label="Open system monitor"
      >
        {s ? (
          <span className="text-xs tabular-nums">
            CPU {s.cpu?.toFixed(0) ?? "N/A"}% · RAM {bytes(s.memoryUsed)}
            <br />
            Free {bytes(s.diskFree)} · ↓{rate(s.networkDown)} ↑{rate(s.networkUp)}
          </span>
        ) : error ? (
          "Monitor unavailable"
        ) : (
          "System monitor…"
        )}
      </Button>
    </div>
  );
}
function Chart({
  samples,
  metric,
  title,
}: {
  samples: readonly MachineSample[];
  metric: (s: MachineSample) => number;
  title: string;
}) {
  const values = samples.map(metric);
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => `${(i * 600) / Math.max(1, values.length - 1)},${70 - (v / max) * 65}`)
    .join(" ");
  return (
    <figure>
      <figcaption className="text-sm">{title}</figcaption>
      <svg
        viewBox="0 0 600 75"
        role="img"
        aria-label={`${title} history`}
        className="w-full text-primary"
      >
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </figure>
  );
}
export function SystemMonitorView() {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const id = selected ?? primary;
  const { data, error } = useMonitor(id);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"memory" | "cpu">("memory");
  return (
    <div className="space-y-4">
      {environments.length > 1 ? (
        <select
          aria-label="Monitor environment"
          value={id ?? ""}
          onChange={(event) => setSelected(event.target.value as EnvironmentId)}
        >
          {environments.map((e) => (
            <option key={e.environmentId} value={e.environmentId}>
              {e.label}
            </option>
          ))}
        </select>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {data ? (
        <>
          <p className="text-sm tabular-nums">
            CPU {data.sample.cpu?.toFixed(1) ?? "N/A"}% · RAM {bytes(data.sample.memoryUsed)} /{" "}
            {bytes(data.sample.memoryTotal)} · Available {bytes(data.sample.memoryAvailable)}
          </p>
          <p className="text-sm">
            Memory pressure: {data.sample.pressure} · Swap {bytes(data.sample.swapUsed)} /{" "}
            {bytes(data.sample.swapTotal)}
          </p>
          <p className="text-sm">
            Storage free {bytes(data.sample.diskFree)} / {bytes(data.sample.diskTotal)} · ↓{" "}
            {rate(data.sample.networkDown)} · ↑ {rate(data.sample.networkUp)}
          </p>
          <p className="text-sm">
            Load {data.sample.load.map((v) => v.toFixed(2)).join(" / ")} · Uptime{" "}
            {(data.sample.uptime / 3600).toFixed(1)} hours
          </p>
          <Chart samples={data.history} title="CPU %" metric={(s) => s.cpu ?? 0} />
          <Chart samples={data.history} title="Memory used" metric={(s) => s.memoryUsed} />
          <Chart
            samples={data.history}
            title="Network download"
            metric={(s) => s.networkDown ?? 0}
          />
          <Chart samples={data.history} title="Network upload" metric={(s) => s.networkUp ?? 0} />
          <div className="flex gap-2">
            <Input
              aria-label="Search processes"
              placeholder="Search top processes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="outline" onClick={() => setSort(sort === "memory" ? "cpu" : "memory")}>
              Sort: {sort}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Process snapshot: {new Date(data.processesAt).toLocaleTimeString()}. Top 30 per metric.
            CPU may exceed 100%.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Process / owner</th>
                <th>PID</th>
                <th>RAM (RSS)</th>
                <th>CPU</th>
              </tr>
            </thead>
            <tbody>
              {(sort === "memory" ? data.topMemory : data.topCpu)
                .filter((p) =>
                  `${p.name} ${p.owner ?? ""} ${p.pid} ${p.cwd ?? ""}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <tr key={p.pid}>
                    <td>
                      {p.name}
                      {p.owner ? ` (${p.owner})` : ""}
                    </td>
                    <td className="text-center">{p.pid}</td>
                    <td className="text-center">{bytes(p.rss)}</td>
                    <td className="text-center">{p.cpu.toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <h3 className="text-sm font-medium">Projects</h3>
          {data.projects.map((p) => (
            <p className="text-sm" key={p.id}>
              {p.title} · {bytes(p.rss)} · {p.cpu.toFixed(1)}% CPU · {p.count} processes
            </p>
          ))}
          {data.limitations.map((message) => (
            <p key={message} className="text-xs text-muted-foreground">
              {message}
            </p>
          ))}
        </>
      ) : !error ? (
        <p>Waiting for a connected environment…</p>
      ) : null}
    </div>
  );
}
