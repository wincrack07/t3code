import { LoaderCircleIcon, WandSparklesIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Runs `/polish` on the whole draft. */
export function ComposerPolishButton(props: {
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onPolish: () => void;
}) {
  const label = props.running ? "Polishing prompt..." : "Polish prompt";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            aria-busy={props.running || undefined}
            disabled={props.disabled || props.running}
            onPointerDown={(event) => event.preventDefault()}
            onClick={props.onPolish}
          >
            {props.running ? <LoaderCircleIcon className="animate-spin" /> : <WandSparklesIcon />}
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
