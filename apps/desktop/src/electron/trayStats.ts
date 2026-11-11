import type { MachineSample, TrayStatsSettings } from "@t3tools/contracts";

function number(value: number | null, width: number, decimals = 0, maximum = 100) {
  return (
    value === null || !Number.isFinite(value)
      ? "n/a"
      : Math.min(maximum, Math.max(0, value)).toFixed(decimals)
  ).padStart(width, " ");
}

export function trayRate(bytes: number | null) {
  const mb = bytes === null ? null : bytes / 1_000_000;
  return number(mb !== null && mb < 0.1 ? 0 : mb, 7, 1, 99999.9);
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

export function trayStatsRows(sample?: MachineSample) {
  return sample
    ? [
        `CPU: ${number(sample.cpu, 0)}% · Load: ${sample.load.map((n) => n.toFixed(2)).join(" / ")}`,
        `Memory: ${gb(sample.memoryUsed)} / ${gb(sample.memoryTotal)} (${number(percent(sample.memoryUsed, sample.memoryTotal), 0)}%)`,
        `Disk: ${gb(sample.diskFree)} free / ${gb(sample.diskTotal)} (system volume)`,
        `Network: ↓${trayRate(sample.networkDown).trim()} / ↑${trayRate(sample.networkUp).trim()} MB/s`,
      ]
    : ["Machine stats: waiting for local sample"];
}
