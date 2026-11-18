import { formatMachineRate } from "@t3tools/client-runtime/state/machine-monitor";
import type { MachineSample } from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";

import { cn } from "~/lib/utils";
import type { MessageResolver } from "~/i18n/messages";

export type MachineHistoryMetric = "usage" | "network";

interface Series {
  readonly label: string;
  readonly className: string;
  /** Secondary series are dashed so the pair reads apart without relying on color. */
  readonly dashed?: boolean;
  readonly value: (sample: MachineSample) => number | null;
}

const SERIES: Record<MachineHistoryMetric, readonly Series[]> = {
  usage: [
    { label: "CPU", className: "text-primary", value: (s) => s.cpu },
    {
      label: msg("Memory"),
      className: "text-muted-foreground",
      dashed: true,
      value: (s) => (s.memoryTotal > 0 ? (100 * s.memoryUsed) / s.memoryTotal : null),
    },
  ],
  network: [
    {
      label: msg("Download", { $context: "network traffic received" }),
      className: "text-primary",
      value: (s) => s.networkDown,
    },
    {
      label: msg("Upload", { $context: "network traffic sent" }),
      className: "text-muted-foreground",
      dashed: true,
      value: (s) => s.networkUp,
    },
  ],
};

const WIDTH = 600;
const HEIGHT = 160;

function formatWindow(ms: number, resolve: MessageResolver) {
  return ms >= 3_600_000
    ? resolve(msg("{count} h ago", { count: Math.round(ms / 3_600_000) }))
    : resolve(msg("{count} min ago", { count: Math.round(ms / 60_000) }));
}

function formatSpan(ms: number, resolve: MessageResolver) {
  return ms >= 3_600_000
    ? resolve(msg("{count} h", { count: Math.round(ms / 3_600_000) }))
    : resolve(msg("{count} min", { count: Math.round(ms / 60_000) }));
}

/** History is mixed resolution (2 s recent, 5 min older), so points sit on a time axis. */
export function MachineHistoryChart(props: {
  history: readonly MachineSample[];
  metric: MachineHistoryMetric;
  windowMs: number;
  now: number;
}) {
  const gt = useGT();
  const messages = useMessages();
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
        <T>Collecting history. The first points appear within a few seconds</T>
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
          aria-label={gt("{first} and {second} over the last {window}", {
            first: messages(series[0]!.label),
            second: messages(series[1]!.label),
            window: formatSpan(props.windowMs, messages),
          })}
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
              strokeWidth={line.dashed ? 1.5 : 1.75}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pr-16 font-mono text-2xs text-muted-foreground">
        <span>{formatWindow(props.windowMs, messages)}</span>
        <span>
          <T context="right end of a time axis">now</T>
        </span>
      </div>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {series.map((line, index) => {
          const points = values[index]!;
          if (points.length === 0) return null;
          const top = Math.max(...points.map((p) => p.value));
          const average = points.reduce((sum, p) => sum + p.value, 0) / points.length;
          return (
            <span key={line.label} className="flex items-center gap-2">
              <svg aria-hidden viewBox="0 0 16 2" className={cn("h-0.5 w-4", line.className)}>
                <line
                  x1="0"
                  y1="1"
                  x2="16"
                  y2="1"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={line.dashed ? "4 3" : undefined}
                />
              </svg>
              <span className="text-foreground">{messages(line.label)}</span>
              <span className="text-muted-foreground tabular-nums">
                <T>
                  peak <Var>{format(top)}</Var> · average <Var>{format(average)}</Var>
                </T>
              </span>
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
