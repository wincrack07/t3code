import type { MachineMonitorSnapshot, MachineSample } from "@t3tools/contracts";

export function mergeMachineMonitorSnapshot(
  previous: MachineMonitorSnapshot | undefined,
  value: MachineMonitorSnapshot,
) {
  const newer = previous === undefined || value.sample.at >= previous.sample.at;
  const details = value.details ?? previous?.details;
  return {
    ...value,
    ...(details === undefined ? {} : { details }),
    sample: newer ? value.sample : previous.sample,
    history: !newer
      ? previous.history
      : value.history.length
        ? value.history
        : previous?.sample.at === value.sample.at
          ? previous.history
          : [...(previous?.history ?? []), value.sample].slice(-738),
  };
}

export type MachineHealthLevel = "ok" | "busy" | "strained";

export interface MachineHealthReason {
  readonly level: Exclude<MachineHealthLevel, "ok">;
  readonly label: string;
}

export interface MachineHealth {
  readonly level: MachineHealthLevel;
  /** Short status, like "Healthy" or "Memory high". */
  readonly headline: string;
  /** Every metric past its limit, worst first. */
  readonly reasons: readonly MachineHealthReason[];
  /** Shares from 0 to 1, null when the host could not measure them. */
  readonly cpu: number | null;
  readonly memory: number | null;
  readonly disk: number | null;
  readonly cpuLevel: MachineHealthLevel;
  readonly memoryLevel: MachineHealthLevel;
  readonly diskLevel: MachineHealthLevel;
}

// CPU and memory limits match the activity board and automatic machine selection.
const BUSY_CPU = 0.75;
const STRAINED_CPU = 0.95;
const BUSY_MEMORY = 0.85;
const STRAINED_MEMORY = 0.95;
const BUSY_DISK_FREE = 10 * 1024 ** 3;
const STRAINED_DISK_FREE = 2 * 1024 ** 3;

const share = (used: number, total: number | null) =>
  total === null || total <= 0 ? null : Math.min(1, Math.max(0, used / total));
const byLimit = (value: number | null, busy: number, strained: number): MachineHealthLevel =>
  value === null ? "ok" : value >= strained ? "strained" : value >= busy ? "busy" : "ok";
const worse = (a: MachineHealthLevel, b: MachineHealthLevel) =>
  a === "strained" || b === "strained" ? "strained" : a === "busy" || b === "busy" ? "busy" : "ok";

export function presentMachineHealth(sample: MachineSample): MachineHealth {
  const cpu = sample.cpu === null ? null : Math.min(1, Math.max(0, sample.cpu / 100));
  const memory = share(sample.memoryUsed, sample.memoryTotal);
  const disk =
    sample.diskFree === null ? null : share(sample.diskTotal! - sample.diskFree, sample.diskTotal);
  const cpuLevel = byLimit(cpu, BUSY_CPU, STRAINED_CPU);
  const pressureLevel: MachineHealthLevel =
    sample.pressure === "critical" ? "strained" : sample.pressure === "warning" ? "busy" : "ok";
  const shareLevel = byLimit(memory, BUSY_MEMORY, STRAINED_MEMORY);
  const memoryLevel = worse(shareLevel, pressureLevel);
  const diskLevel: MachineHealthLevel =
    sample.diskFree === null
      ? "ok"
      : sample.diskFree < STRAINED_DISK_FREE
        ? "strained"
        : sample.diskFree < BUSY_DISK_FREE
          ? "busy"
          : "ok";
  const candidates: [MachineHealthLevel, string][] = [
    [memoryLevel, shareLevel === memoryLevel ? "Memory high" : "Memory pressure"],
    [cpuLevel, "CPU busy"],
    [diskLevel, "Disk almost full"],
  ];
  const reasons = candidates
    .flatMap(([level, label]): MachineHealthReason[] => (level === "ok" ? [] : [{ level, label }]))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "strained" ? -1 : 1));
  return {
    level: reasons[0]?.level ?? "ok",
    headline: reasons[0]?.label ?? "Healthy",
    reasons,
    cpu,
    memory,
    disk,
    cpuLevel,
    memoryLevel,
    diskLevel,
  };
}

/** Binary units with the familiar labels, one decimal from GB up. */
export function formatMachineBytes(value: number): string {
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

export function formatMachineRate(value: number): string {
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB/s`;
  return `${Math.round(value / 1024)} KB/s`;
}

export function formatMachinePercent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

export function formatMachineUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
