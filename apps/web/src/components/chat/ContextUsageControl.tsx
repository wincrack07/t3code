import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";

type ContextUsageTone = "normal" | "warning" | "danger";

function contextUsageTone(
  percentage: number | null,
  compactionSuggested: boolean,
): ContextUsageTone {
  if (percentage !== null && percentage >= 90) return "danger";
  if (compactionSuggested || (percentage !== null && percentage >= 75)) return "warning";
  return "normal";
}

// The Claude theme draws the calm arc in its blue accent, like the Claude app's usage ring.
const RING_TONE_CLASS: Record<ContextUsageTone, string> = {
  normal: "stroke-primary [html[data-theme-id=claude]_&]:stroke-(--app-theme-focus)",
  warning: "stroke-warning",
  danger: "stroke-destructive",
};

const BAR_TONE_CLASS: Record<ContextUsageTone, string> = {
  normal: "bg-primary [html[data-theme-id=claude]_&]:bg-(--app-theme-focus)",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function ContextUsageControl(props: {
  tokens: number;
  percentage: number | null;
  compactionSuggested: boolean;
  compactDisabled: boolean;
  onCompact: () => void;
}) {
  const percent =
    props.percentage === null ? null : Math.min(100, Math.max(0, Math.round(props.percentage)));
  const tone = contextUsageTone(percent, props.compactionSuggested);
  const used = formatContextWindowTokens(props.tokens);
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={250}
        closeDelay={150}
        render={
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-accent"
            aria-label={`Context window: ${used} tokens${percent === null ? "" : `, ${percent}%`}`}
          />
        }
      >
        <svg className="size-3.5" viewBox="0 0 16 16" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            className={RING_TONE_CLASS[tone]}
            strokeWidth="2"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${percent ?? 0} 100`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        {used}
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" padding="compact" width="sm">
        <div className="grid gap-3 py-1 text-sm">
          <div className="text-muted-foreground text-xs">Context window · this thread</div>
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span>{used} tokens used</span>
              {percent === null ? null : (
                <span className="text-muted-foreground text-xs tabular-nums">{percent}%</span>
              )}
            </div>
            {percent === null ? null : (
              <div className="h-1 overflow-hidden rounded-full bg-input">
                <div
                  className={cn("h-full rounded-full", BAR_TONE_CLASS[tone])}
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <PopoverClose
              render={
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={props.compactDisabled}
                  onClick={props.onCompact}
                />
              }
            >
              Compact context
            </PopoverClose>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
