import { XIcon } from "lucide-react";
import { createContext, type DragEvent } from "react";

import { useThreadColumnsStore } from "../threadColumnsStore";
import { endThreadContextDrag, THREAD_COLUMN_DRAG_TYPE } from "./chat/threadContextDrag";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

/** The split column the active chat renders in, so its header can carry the column's chrome. */
export interface ThreadColumnHeader {
  readonly id: string;
  readonly title: string;
  readonly first: boolean;
}

export const ThreadColumnHeaderContext = createContext<ThreadColumnHeader | null>(null);

export function threadColumnDragProps(id: string) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(THREAD_COLUMN_DRAG_TYPE, id);
      const host = event.currentTarget.closest<HTMLElement>("[data-thread-columns]");
      if (host) host.dataset.columnReordering = "true";
    },
    onDragEnd: (event: DragEvent<HTMLElement>) => {
      const host = event.currentTarget.closest<HTMLElement>("[data-thread-columns]");
      if (host) delete host.dataset.columnReordering;
      endThreadContextDrag();
    },
  };
}

export function ThreadColumnCloseButton({
  column,
  separated = false,
}: {
  column: Pick<ThreadColumnHeader, "id" | "title">;
  separated?: boolean;
}) {
  return (
    <>
      {separated ? <Separator orientation="vertical" className="mx-1 h-4" /> : null}
      <Button
        data-close-column
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label={`Close column: ${column.title}`}
        onClick={(event) => {
          event.stopPropagation();
          useThreadColumnsStore.getState().close(column.id);
        }}
      >
        <XIcon />
      </Button>
    </>
  );
}
