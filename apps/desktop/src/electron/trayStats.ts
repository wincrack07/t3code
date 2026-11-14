import { formatMachineBytes } from "@t3tools/client-runtime/state/machine-monitor";
import type { MachineSample, TrayStatsSettings } from "@t3tools/contracts";

function number(value: number | null, decimals = 0, maximum = 100) {
  return value === null || !Number.isFinite(value)
    ? "n/a"
    : Math.min(maximum, Math.max(0, value)).toFixed(decimals);
}

// macOS draws padding spaces wider than digits in the menu bar, so rates keep four real
// characters below 100 MB/s instead of being padded to a fixed width.
export function trayRate(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "n/a";
  const mb = Math.max(0, bytes) / 1_000_000;
  if (Number(mb.toFixed(2)) < 10) return mb.toFixed(2);
  if (Number(mb.toFixed(1)) < 100) return mb.toFixed(1);
  return mb >= 999.5 ? "999+" : mb.toFixed(0);
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
    settings.cpu ? `CPU ${number(sample?.cpu ?? null)}%` : null,
    settings.memory
      ? `RAM ${number(sample ? percent(sample.memoryUsed, sample.memoryTotal) : null)}%`
      : null,
    settings.disk
      ? `Disk ${number(sample ? percent(sample.diskFree, sample.diskTotal) : null)}% free`
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
