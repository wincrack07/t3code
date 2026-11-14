import { expect, it } from "@effect/vitest";
import { DEFAULT_TRAY_STATS, type MachineSample } from "@t3tools/contracts";
import { changedTitle, trayRate, trayStatsTitle, trayStatsRows } from "./trayStats.ts";

it("formats rates with four real characters below 100 MB/s and no padding", () => {
  expect(
    [null, 0, 23000, 99999, 100000, 999000, 1e6, 9.996e6, 12.45e6, 99.95e6, 100e6, 999e6, 1e20].map(
      trayRate,
    ),
  ).toEqual([
    "n/a",
    "0.00",
    "0.02",
    "0.10",
    "0.10",
    "1.00",
    "1.00",
    "10.0",
    "12.4",
    "100",
    "100",
    "999",
    "999+",
  ]);
  expect(trayRate(-100)).toBe("0.00");
  for (const value of [0, 0.01, 0.77, 0.999, 1, 9.9, 9.999, 12.4, 99.9]) {
    expect(trayRate(value * 1e6)).toMatch(/^[0-9.]{4}$/);
  }
});

it("composes only enabled fields and restores the legacy title when all are off", () => {
  expect(trayStatsTitle(DEFAULT_TRAY_STATS)).toBe("↓n/a ↑n/a MB/s · CPU n/a%");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, enabled: false })).toBe("");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, network: false })).toBe("CPU n/a%");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, network: false, cpu: false })).toBe("");
  expect(trayStatsTitle({ ...DEFAULT_TRAY_STATS, memory: true, disk: true })).toBe(
    "↓n/a ↑n/a MB/s · CPU n/a% · RAM n/a% · Disk n/a% free",
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
    memoryUsed: 19.5 * 1024 ** 3,
    memoryAvailable: 4.5 * 1024 ** 3,
    memoryTotal: 24 * 1024 ** 3,
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
    "↓12.4 ↑0.80 MB/s · CPU 24% · RAM 81% · Disk 25% free",
  );
  expect(trayStatsTitle(DEFAULT_TRAY_STATS, sample)).not.toMatch(/[\u2007\u2008]/);
  expect(trayStatsRows({ ...sample, networkDown: 23_000, networkUp: 1.4e6 }).at(-1)).toBe(
    "Network: ↓ 23 KB/s / ↑ 1.4 MB/s",
  );
  expect(trayStatsRows(sample)).toEqual([
    "CPU: 24% · Load: 1.20 / 2.00 / 3.46",
    "Memory: 19.5 GB / 24.0 GB (81%)",
    "Disk: 250.0 GB free / 1000.0 GB (system volume)",
    "Network: ↓ 12.4 MB/s / ↑ 800 KB/s",
  ]);
});
