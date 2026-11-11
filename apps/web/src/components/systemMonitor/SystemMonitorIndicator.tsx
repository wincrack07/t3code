import {
  formatMachineBytes,
  formatMachinePercent,
  formatMachineRate,
  presentMachineHealth,
} from "@t3tools/client-runtime/state/machine-monitor";
import { GaugeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MachineHealthDot } from "./MachineMeter";
import { useMachineMonitor } from "./useMachineMonitor";

/**
 * Footer icon that opens the monitor. With the sidebar monitor setting off it stays a plain
 * link and subscribes to nothing, so the health dot and hover numbers disappear with it.
 */
export function SidebarMachineMonitorItem({ onOpen }: { onOpen: () => void }) {
  const enabled = useClientSettings((s) => s.showSystemMonitor);
  return enabled ? <LiveItem onOpen={onOpen} /> : <Item onOpen={onOpen} />;
}

function Item(props: {
  onOpen: () => void;
  label?: string;
  dot?: "busy" | "strained" | "unknown" | null;
  tooltip?: ReactNode;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={props.label ?? "Machine monitor"}
              onClick={props.onOpen}
              size="icon"
            >
              <GaugeIcon />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{props.tooltip ?? "Machine monitor"}</TooltipPopup>
      </Tooltip>
      {props.dot ? (
        <span className="pointer-events-none absolute top-1.5 right-1.5 flex rounded-full ring-2 ring-sidebar">
          <MachineHealthDot level={props.dot} />
        </span>
      ) : null}
    </SidebarMenuItem>
  );
}

function LiveItem({ onOpen }: { onOpen: () => void }) {
  const id = usePrimaryEnvironmentId();
  const phase = useEnvironment(id)?.connection.phase;
  // Samples only: process details are sampled while the monitor page is open.
  const { data, error } = useMachineMonitor(id, false);
  const sample = data?.sample ?? null;
  const connected = phase === undefined || phase === "connected";
  if (sample === null) {
    return (
      <Item
        onOpen={onOpen}
        tooltip={error ? `Machine monitor unavailable: ${error}` : "Machine monitor"}
      />
    );
  }
  const health = presentMachineHealth(sample);
  const headline = connected ? health.headline : "Disconnected, last sample";
  const rows: [string, string][] = [
    ["CPU", formatMachinePercent(health.cpu)],
    [
      "Memory",
      `${formatMachineBytes(sample.memoryUsed)} of ${formatMachineBytes(sample.memoryTotal)} (${formatMachinePercent(health.memory)})`,
    ],
  ];
  if (sample.diskFree !== null && sample.diskTotal !== null) {
    rows.push([
      "Disk",
      `${formatMachineBytes(sample.diskFree)} free of ${formatMachineBytes(sample.diskTotal)}`,
    ]);
  }
  if (sample.networkDown !== null && sample.networkUp !== null) {
    rows.push([
      "Network",
      `↓ ${formatMachineRate(sample.networkDown)}  ↑ ${formatMachineRate(sample.networkUp)}`,
    ]);
  }
  return (
    <Item
      onOpen={onOpen}
      label={`Machine monitor: ${headline}`}
      dot={!connected ? "unknown" : health.level === "ok" ? null : health.level}
      tooltip={
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 font-medium">
            <MachineHealthDot level={connected ? health.level : "unknown"} />
            {headline}
          </span>
          <span className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
            {rows.map(([label, value]) => (
              <span key={label} className="contents">
                <span className="text-muted-foreground">{label}</span>
                <span>{value}</span>
              </span>
            ))}
          </span>
        </span>
      }
    />
  );
}
