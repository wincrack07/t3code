import type { MachineHealthLevel } from "@t3tools/client-runtime/state/machine-monitor";

import { cn } from "~/lib/utils";

// Color appears only when a metric needs attention, so a healthy machine stays quiet.
const BAR: Record<MachineHealthLevel, string> = {
  ok: "bg-muted-foreground/60",
  busy: "bg-warning",
  strained: "bg-destructive",
};
const DOT: Record<MachineHealthLevel | "unknown", string> = {
  ok: "bg-success",
  busy: "bg-warning",
  strained: "bg-destructive",
  unknown: "bg-muted-foreground/40",
};

export function MachineHealthDot({ level }: { level: MachineHealthLevel | "unknown" }) {
  return <span aria-hidden className={cn("inline-flex size-2 shrink-0 rounded-full", DOT[level])} />;
}

/** One labelled share bar; the activity board and the system monitor both use it. */
export function MachineMeter(props: {
  label: string;
  share: number | null;
  level: MachineHealthLevel;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{props.label}</span>
      <MachineShareBar label={props.label} share={props.share} level={props.level} detail={props.detail} />
      <span className="min-w-8 shrink-0 text-right text-muted-foreground tabular-nums">{props.detail}</span>
    </div>
  );
}

export function MachineShareBar(props: {
  label: string;
  share: number | null;
  level: MachineHealthLevel;
  detail: string;
}) {
  const percent = props.share === null ? null : Math.round(props.share * 100);
  return (
    <div
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={props.detail}
      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full", BAR[props.level])}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  );
}
