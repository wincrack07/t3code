import { formatMachineBytes } from "@t3tools/client-runtime/state/machine-monitor";
import type { MachineSample, TrayStatsSettings } from "@t3tools/contracts";

function number(value: number | null, width: number, decimals = 0, maximum = 100) {
  return (
    value === null || !Number.isFinite(value)
      ? "n/a"
      : Math.min(maximum, Math.max(0, value)).toFixed(decimals)
  ).padStart(width, "\u2007");
}

export function trayRate(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "\u2007n/a";
  const mb = Math.max(0, bytes) / 1_000_000;
  if (mb >= 999.5) return "999+";
  const decimal = mb.toFixed(mb < 1 ? 2 : 1);
  // A punctuation space preserves the decimal point's width when rates become integers.
  return Number(decimal) >= 100 ? `${mb.toFixed(0)}\u2008` : decimal.padStart(4, "\u2007");
}

function percent(used: number | null, total: number | null) {
  return used === null || total === null || total <= 0 ? null : (used / total) * 100;
}

export function trayStatsTitle(settings: TrayStatsSettings, sample?: MachineSample) {
  if (!settings.enabled) return "";
  return [
    settings.network
      ? `↓${trayRate(sample?.networkDown ?? null)} ↑${trayRate(sample?.networkUp ?? null)} MB/s`
      : null,
    settings.cpu ? `CPU ${number(sample?.cpu ?? null, 3)}%` : null,
    settings.memory
      ? `RAM ${number(sample ? percent(sample.memoryUsed, sample.memoryTotal) : null, 3)}%`
      : null,
    settings.disk
      ? `Disk ${number(sample ? percent(sample.diskFree, sample.diskTotal) : null, 3)}% free`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export function changedTitle() {
  let previous: string | undefined;
  return (next: string) => {
    if (next === previous) return false;
    previous = next;
    return true;
  };
}

const gb = (value: number | null) =>
  value === null ? "n/a" : `${(value / 1_000_000_000).toFixed(1)} GB`;

function menuRate(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "n/a";
  const value = Math.max(0, bytes);
  return value < 1_000_000
    ? `${Math.round(value / 1000)} KB/s`
    : `${(value / 1_000_000).toFixed(1)} MB/s`;
}

export function trayStatsRows(sample?: MachineSample) {
  return sample
    ? [
        `CPU: ${number(sample.cpu, 0)}% · Load: ${sample.load.map((n) => n.toFixed(2)).join(" / ")}`,
        `Memory: ${formatMachineBytes(sample.memoryUsed)} / ${formatMachineBytes(sample.memoryTotal)} (${number(percent(sample.memoryUsed, sample.memoryTotal), 0)}%)`,
        `Disk: ${gb(sample.diskFree)} free / ${gb(sample.diskTotal)} (system volume)`,
        `Network: ↓ ${menuRate(sample.networkDown)} / ↑ ${menuRate(sample.networkUp)}`,
      ]
    : ["Machine stats: waiting for local sample"];
}
