import type { ScopedThreadRef } from "@t3tools/contracts";
import type { HandoffTimelineRun } from "@t3tools/client-runtime/handoff";
import { T, useGT } from "gt-react";
import { useComposerHandleContext } from "../../composerHandleContext";
import { useComposerDraftStore } from "../../composerDraftStore";
import { Button } from "../ui/button";

export function AutoDecisionRow({
  run,
  threadRef,
}: {
  run: HandoffTimelineRun | undefined;
  threadRef: ScopedThreadRef | null;
}) {
  const composer = useComposerHandleContext();
  const gt = useGT();
  if (!run?.routingDecision) return null;
  const selection = run.modelSelection;
  const effort = selection.options?.find(
    (option) =>
      option.id === run.routingDecision?.choice?.effortOptionId ||
      option.id === "reasoningEffort" ||
      option.id === "effort",
  )?.value;
  return (
    <div
      className="my-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      data-routing-decision="true"
    >
      <span>
        {gt("Auto", { $context: "model routing mode" })} · {selection.instanceId} ·{" "}
        {selection.model}
        {effort ? ` · ${effort}` : ""} · {run.routingDecision.reason}
      </span>
      {threadRef ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            const { routing: _routing, ...manual } = selection;
            useComposerDraftStore
              .getState()
              .setModelSelection(threadRef, manual, { explicit: true, replaceOptions: true });
          }}
        >
          <T>Use this model next</T>
        </Button>
      ) : null}
      {composer ? (
        <Button size="xs" variant="ghost" onClick={() => composer.current?.openModelPicker()}>
          <T>Change model</T>
        </Button>
      ) : null}
    </div>
  );
}
