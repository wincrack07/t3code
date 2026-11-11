import { formatMachineRate } from "@t3tools/client-runtime/state/machine-monitor";
import type { MachineSample } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

export type MachineHistoryMetric = "usage" | "network";

interface Series {
  readonly label: string;
  readonly className: string;
  readonly value: (sample: MachineSample) => number | null;
}

const SERIES: Record<MachineHistoryMetric, readonly Series[]> = {
  usage: [
    { label: "CPU", className: "text-primary", value: (s) => s.cpu },
    {
      label: "Memory",
      className: "text-muted-foreground",
      value: (s) => (s.memoryTotal > 0 ? (100 * s.memoryUsed) / s.memoryTotal : null),
    },
  ],
  network: [
    { label: "Download", className: "text-primary", value: (s) => s.networkDown },
    { label: "Upload", className: "text-muted-foreground", value: (s) => s.networkUp },
  ],
};

const WIDTH = 600;
const HEIGHT = 160;

function formatWindow(ms: number) {
  return ms >= 3_600_000
    ? `${Math.round(ms / 3_600_000)} h ago`
    : `${Math.round(ms / 60_000)} min ago`;
}

/** History is mixed resolution (2 s recent, 5 min older), so points sit on a time axis. */
export function MachineHistoryChart(props: {
  history: readonly MachineSample[];
  metric: MachineHistoryMetric;
  windowMs: number;
  now: number;
}) {
  const start = props.now - props.windowMs;
  const samples = props.history.filter((s) => s.at >= start && s.at <= props.now);
  const series = SERIES[props.metric];
  const values = series.map((line) =>
    samples.flatMap((s) => {
      const value = line.value(s);
      return value === null ? [] : [{ at: s.at, value }];
    }),
  );
  const peak = Math.max(0, ...values.flat().map((p) => p.value));
  const max = props.metric === "usage" ? 100 : Math.max(1024, peak);
  const format = (value: number) =>
    props.metric === "usage" ? `${Math.round(value)}%` : formatMachineRate(value);

  if (values.every((points) => points.length < 2)) {
    return (
      <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Collecting history. The first points appear within a few seconds
      </p>
    );
  }

  return (
    <figure className="flex flex-col gap-3">
      <div className="relative h-40">
        {[0, 0.5, 1].map((step) => (
          <div
            key={step}
            className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2"
            style={{ top: `${(1 - step) * 100}%` }}
          >
            <span className="h-px flex-1 bg-border/60" />
            <span className="w-14 text-right font-mono text-2xs text-muted-foreground tabular-nums">
              {format(max * step)}
            </span>
          </div>
        ))}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${series.map((line) => line.label).join(" and ")} over the last ${formatWindow(props.windowMs).replace(" ago", "")}`}
          className="absolute inset-y-0 left-0 h-full w-[calc(100%-4rem)] overflow-visible"
        >
          {series.map((line, index) => (
            <polyline
              key={line.label}
              className={line.className}
              points={values[index]!.map(
                (p) =>
                  `${(((p.at - start) / props.windowMs) * WIDTH).toFixed(1)},${(HEIGHT - (p.value / max) * HEIGHT).toFixed(1)}`,
              ).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={index === 0 ? 1.75 : 1.25}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pr-16 font-mono text-2xs text-muted-foreground">
        <span>{formatWindow(props.windowMs)}</span>
        <span>now</span>
      </div>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {series.map((line, index) => {
          const points = values[index]!;
          if (points.length === 0) return null;
          const top = Math.max(...points.map((p) => p.value));
          const average = points.reduce((sum, p) => sum + p.value, 0) / points.length;
          return (
            <span key={line.label} className="flex items-center gap-2">
              <span className={cn("h-0.5 w-3 rounded-full bg-current", line.className)} />
              <span className="text-foreground">{line.label}</span>
              <span className="text-muted-foreground tabular-nums">
                peak {format(top)} · average {format(average)}
              </span>
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
