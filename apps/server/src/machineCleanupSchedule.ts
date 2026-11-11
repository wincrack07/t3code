import type { MachineCleanupReport, MachineCleanupSettings } from "@t3tools/contracts";

export function cleanupScheduleDay(
  settings: MachineCleanupSettings,
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  lastDay: string,
): string | null {
  if (!settings.scheduleEnabled) return null;
  const [hour, minute] = settings.scheduleTime.split(":").map(Number);
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (day === lastDay || parts.hour * 60 + parts.minute < hour! * 60 + minute!) return null;
  return day;
}

export function cleanupNotification(
  report: MachineCleanupReport,
  lowSpaceGiB: number,
): string | null {
  if (report.mode === "scan") return null;
  const pending = report.items.filter((item) => item.phase === "B" && item.outcome === "pending");
  const freed = Math.max(0, report.freeAfter - report.freeBefore);
  const low = report.freeAfter < lowSpaceGiB * 1024 ** 3;
  const relevant = report.items.some(
    (item) => item.outcome === "removed" || item.outcome === "failed" || item.outcome === "skipped",
  );
  if (!pending.length && !low && !relevant) return null;
  const bytes = pending.reduce((sum, item) => sum + item.bytes, 0);
  return `Cleanup: freed ${(freed / 1e9).toFixed(1)} GB. ${(bytes / 1e9).toFixed(1)} GB more await your approval.${low ? ` Low space: ${(report.freeAfter / 1e9).toFixed(1)} GB available.` : ""}`;
}

export function selectedMachineCleanupItems(
  report: MachineCleanupReport,
  mode: MachineCleanupReport["mode"],
  ids: readonly string[],
) {
  if (mode === "scan") return [];
  return report.items.filter(
    (item) =>
      item.outcome === "pending" &&
      ((item.phase === "A" && mode !== "phaseB") ||
        (mode === "phaseB" && item.phase === "B" && ids.includes(item.id)) ||
        (mode === "phaseC" && item.phase === "C" && ids.includes(item.id))),
  );
}
