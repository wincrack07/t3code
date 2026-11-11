import { expect, it } from "@effect/vitest";
import { DEFAULT_TRAY_STATS, type MachineSample } from "@t3tools/contracts";
import { changedTitle, trayRate, trayStatsTitle, trayStatsRows } from "./trayStats.ts";

it("formats decimal megabytes, thresholds, rounding and bounded fixed width", () => {
  expect([null, 0, 99999, 100000, 12450000, 1e20].map(trayRate)).toEqual([
    "    n/a",
    "    0.0",
    "    0.0",
    "    0.1",
    "   12.4",
    "99999.9",
  ]);
  expect(trayRate(12560000)).toBe("   12.6");
  expect(trayRate(-100)).toBe("    0.0");
  expect(trayRate(Infinity)).toBe("    n/a");
});

it("composes only enabled fields and restores the legacy title when all are off", () => {
  expect(trayStatsTitle(DEFAULT_TRAY_STATS)).toBe("↓    n/a ↑    n/a MB/s · CPU n/a%");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, enabled: false })).toBe("");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, network: false })).toBe("CPU n/a%");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, network: false, cpu: false })).toBe("");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, memory: true, disk: true })).toBe(
    "↓    n/a ↑    n/a MB/s · CPU n/a% · RAM n/a% · Disk n/a% free",
  );
});

it("updates once for each distinct formatted title", () => {
  const changed = changedTitle();
  expect(["CPU  23%", "CPU  23%", "CPU  24%", "", "", "CPU  24%"].map(changed)).toEqual([
    true,
    false,
    true,
    true,
    false,
    true,
  ]);
});

it("rounds percentages and presents complete menu readings", () => {
  const sample: MachineSample = {
    at: 1,
    cpu: 23.6,
    memoryUsed: 8e9,
    memoryAvailable: 8e9,
    memoryTotal: 16e9,
    pressure: "normal",
    swapUsed: 0,
    swapTotal: 0,
    diskFree: 250e9,
    diskTotal: 1e12,
    networkDown: 12.4e6,
    networkUp: 0.8e6,
    load: [1.2, 2, 3.456],
    uptime: 1,
  };
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, memory: true, disk: true }, sample)).toBe(
    "↓   12.4 ↑    0.8 MB/s · CPU  24% · RAM  50% · Disk  25% free",
  );
  expect(trayStatsTitle(DEFAULT_TRAY_STATS, { ...sample, cpu: 0 }).length).toBe(
    trayStatsTitle(DEFAULT_TRAY_STATS, { ...sample, cpu: 100, networkDown: 1e30 }).length,
  );
  expect(trayStatsRows(sample)).toEqual([
    "CPU: 24% · Load: 1.20 / 2.00 / 3.46",
    "Memory: 8.0 GB / 16.0 GB (50%)",
    "Disk: 250.0 GB free / 1000.0 GB (system volume)",
    "Network: ↓12.4 / ↑0.8 MB/s",
  ]);
});
