import { expect, it } from "@effect/vitest";
import type { MachineMonitorSnapshot } from "@t3tools/contracts";
import { mergeMachineMonitorSnapshot, presentMachineHealth } from "./machineMonitor.ts";

it("retains process details between resource frames without duplicating or regressing history", () => {
  const frame = (at: number): MachineMonitorSnapshot => ({
    sample: {
      at,
      cpu: 10,
      memoryUsed: 1,
      memoryAvailable: 1,
      memoryTotal: 2,
      pressure: "normal",
      swapUsed: 0,
      swapTotal: 0,
      diskFree: 1,
      diskTotal: 2,
      networkDown: 0,
      networkUp: 0,
      load: [0, 0, 0],
      uptime: 1,
    },
    history: [],
    limitations: [],
  });
  const first = frame(1);
  const details = {
    sampledAt: 1,
    topCpu: [],
    topMemory: [],
    projects: [],
    threads: [],
    limitations: [],
  };
  const initial = mergeMachineMonitorSnapshot(undefined, first);
  const withDetails = mergeMachineMonitorSnapshot(initial, { ...first, details });
  expect(withDetails.history).toEqual([first.sample]);
  const resource = frame(2);
  const updated = mergeMachineMonitorSnapshot(withDetails, resource);
  expect(updated.details).toBe(details);
  expect(updated.history).toEqual([first.sample, resource.sample]);
  const delayed = mergeMachineMonitorSnapshot(updated, { ...first, history: [first.sample] });
  expect(delayed.sample).toBe(resource.sample);
  expect(delayed.history).toBe(updated.history);
  expect(delayed.details).toBe(details);
  const restored = mergeMachineMonitorSnapshot(updated, {
    ...frame(3),
    history: [frame(0).sample, frame(3).sample],
  });
  expect(restored.history.map((s) => s.at)).toEqual([0, 3]);
});

it("states machine health from the worst metric past its limit", () => {
  const GB = 1024 ** 3;
  const sample = (patch: Partial<MachineMonitorSnapshot["sample"]>) => ({
    at: 1,
    cpu: 30,
    memoryUsed: 6 * GB,
    memoryAvailable: 6 * GB,
    memoryTotal: 12 * GB,
    pressure: "normal" as const,
    swapUsed: null,
    swapTotal: null,
    diskFree: 40 * GB,
    diskTotal: 100 * GB,
    networkDown: null,
    networkUp: null,
    load: [],
    uptime: 1,
    ...patch,
  });
  const healthy = presentMachineHealth(sample({}));
  expect(healthy).toMatchObject({ level: "ok", headline: "Healthy", cpu: 0.3, memory: 0.5 });
  expect(healthy.disk).toBeCloseTo(0.6);
  expect(
    presentMachineHealth(sample({ cpu: null, diskFree: null, diskTotal: null })),
  ).toMatchObject({ level: "ok", cpu: null, disk: null });
  expect(presentMachineHealth(sample({ cpu: 80 }))).toMatchObject({
    level: "busy",
    headline: "CPU busy",
    cpuLevel: "busy",
  });
  expect(presentMachineHealth(sample({ pressure: "warning" }))).toMatchObject({
    level: "busy",
    headline: "Memory pressure",
    memoryLevel: "busy",
  });
  expect(presentMachineHealth(sample({ memoryUsed: 10.5 * GB })).headline).toBe("Memory high");
  const mixed = presentMachineHealth(sample({ cpu: 80, diskFree: 1 * GB }));
  expect(mixed.level).toBe("strained");
  expect(mixed.reasons.map((r) => r.label)).toEqual(["Disk almost full", "CPU busy"]);
  expect(presentMachineHealth(sample({ memoryUsed: 11.7 * GB })).memoryLevel).toBe("strained");
});
