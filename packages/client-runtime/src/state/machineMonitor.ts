import type { MachineMonitorSnapshot } from "@t3tools/contracts";

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
