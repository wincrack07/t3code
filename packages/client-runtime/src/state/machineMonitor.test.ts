import { expect, it } from "@effect/vitest";
import type { MachineMonitorSnapshot } from "@t3tools/contracts";
import { mergeMachineMonitorSnapshot } from "./machineMonitor.ts";

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
