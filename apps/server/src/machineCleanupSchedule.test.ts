import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { DEFAULT_MACHINE_CLEANUP_SETTINGS, type MachineCleanupReport } from "@t3tools/contracts";
import {
  cleanupNotification,
  cleanupScheduleDay,
  selectedMachineCleanupItems,
} from "./machineCleanupSchedule.ts";

it("runs at local 06:00 once per date, catches up and respects off", () => {
  const settings = { ...DEFAULT_MACHINE_CLEANUP_SETTINGS, scheduleEnabled: true };
  const parts = { year: 2026, month: 11, day: 11, hour: 5, minute: 59 };
  expect(cleanupScheduleDay(settings, parts, "")).toBeNull();
  expect(cleanupScheduleDay(settings, { ...parts, hour: 6, minute: 0 }, "")).toBe("2026-11-11");
  expect(cleanupScheduleDay(settings, { ...parts, hour: 9 }, "")).toBe("2026-11-11");
  expect(cleanupScheduleDay(settings, { ...parts, hour: 9 }, "2026-11-11")).toBeNull();
  expect(
    cleanupScheduleDay({ ...settings, scheduleEnabled: false }, { ...parts, hour: 9 }, ""),
  ).toBeNull();
  const fallback = { ...settings, scheduleTime: "01:30" };
  const first = DateTime.toParts(
    DateTime.makeZonedUnsafe("2026-11-01T05:30:00Z", { timeZone: "America/New_York" }),
  );
  const repeated = DateTime.toParts(
    DateTime.makeZonedUnsafe("2026-11-01T06:30:00Z", { timeZone: "America/New_York" }),
  );
  const day = cleanupScheduleDay(fallback, first, "");
  expect(day).toBe("2026-11-1");
  expect(cleanupScheduleDay(fallback, repeated, day!)).toBeNull();
});

it("notifies only for pending work, meaningful outcomes or low space and never for a dry run", () => {
  const report: MachineCleanupReport = {
    id: "fixture",
    mode: "unattended",
    platform: "linux",
    startedAt: "2026-11-11T06:00:00Z",
    finishedAt: "2026-11-11T06:01:00Z",
    measurementPath: "/fixture",
    freeBefore: 20 * 1024 ** 3,
    freeAfter: 20 * 1024 ** 3,
    items: [],
    notes: [],
  };
  expect(cleanupNotification(report, 10)).toBeNull();
  expect(cleanupNotification({ ...report, freeAfter: 5 * 1024 ** 3 }, 10)).toContain("Low space");
  expect(cleanupNotification({ ...report, mode: "scan", freeAfter: 5 * 1024 ** 3 }, 10)).toBeNull();
});

it("unattended mode selects only A, even if B/C IDs arrive as input", () => {
  const items = (["A", "B", "C"] as const).map((phase) => ({
    id: phase,
    phase,
    path: `/fixture/${phase}`,
    rule: "fixture",
    bytes: 1,
    effect: "fixture",
    probablyActive: false,
    outcome: "pending" as const,
    reason: "",
    project: "",
    branch: null,
    head: null,
    changes: 0,
  }));
  const report: MachineCleanupReport = {
    id: "fixture",
    mode: "scan",
    platform: "linux",
    startedAt: "2026-11-11T06:00:00Z",
    finishedAt: null,
    measurementPath: "/fixture",
    freeBefore: 1,
    freeAfter: 1,
    items,
    notes: [],
  };
  expect(
    selectedMachineCleanupItems(report, "unattended", ["B", "C"]).map((item) => item.id),
  ).toEqual(["A"]);
  expect(selectedMachineCleanupItems(report, "phaseA", ["B", "C"]).map((item) => item.id)).toEqual([
    "A",
  ]);
  expect(selectedMachineCleanupItems(report, "phaseB", ["B"]).map((item) => item.id)).toEqual([
    "B",
  ]);
  expect(selectedMachineCleanupItems(report, "phaseB", []).map((item) => item.id)).toEqual([]);
  expect(selectedMachineCleanupItems(report, "phaseC", ["C"]).map((item) => item.id)).toEqual([
    "A",
    "C",
  ]);
});
