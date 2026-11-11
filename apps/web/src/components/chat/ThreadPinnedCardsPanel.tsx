import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { PanelRightOpenIcon, XIcon } from "lucide-react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** Live cards an agent pinned into Thread Details. They mount only while the card is open. */
export function ThreadPinnedCardsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const cards = useThreadShell(threadRef)?.pinnedHtmlCards?.filter(
    (card) => card.placement === "details",
  );
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  if (!cards?.length) return null;

  const remove = async (cardId: string) => {
    const result = await updateMetadata({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, unpinHtmlCard: cardId },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not remove the card",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };

  return cards.map((card) => (
    <ThreadDetailsSection
      key={card.id}
      headingId={`thread-details-card-${card.id}-heading`}
      title={card.title}
      actions={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  aria-label={`Open ${card.title} in the panel`}
                  onClick={() => useRightPanelStore.getState().openHtmlCard(threadRef, card)}
                />
              }
            >
              <PanelRightOpenIcon aria-hidden className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="left">Open in the panel</TooltipPopup>
          </Tooltip>
          {canOperate ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    aria-label={`Remove ${card.title}`}
                    onClick={() => void remove(card.id)}
                  />
                }
              >
                <XIcon aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="left">Remove card</TooltipPopup>
            </Tooltip>
          ) : null}
        </>
      }
    >
      <div data-thread-details-html-card className="mx-2 max-h-80 overflow-y-auto rounded-lg">
        <HtmlRenderFrame
          key={card.attachmentId}
          environmentId={props.environmentId}
          threadRef={threadRef}
          htmlRender={card}
        />
      </div>
    </ThreadDetailsSection>
  ));
}
