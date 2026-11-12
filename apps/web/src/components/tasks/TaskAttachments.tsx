import { FileIcon, FolderIcon, PaperclipIcon, XIcon } from "lucide-react";

import { formatBytes } from "../../lib/formatBytes";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * What the task detail shows for one attachment. The backend fills these later; until then
 * every caller passes an empty list and the strip renders nothing.
 */
export type TaskAttachmentView =
  | {
      readonly kind: "image";
      readonly id: string;
      readonly name: string;
      readonly previewUrl: string;
      readonly sizeBytes: number | null;
    }
  | {
      readonly kind: "path";
      readonly id: string;
      readonly path: string;
      readonly isDirectory: boolean;
      readonly state: "ok" | "missing";
      readonly sizeBytes: number | null;
    };

/** Editing hooks the task detail wires to its editor once attachments can be stored. */
export interface TaskAttachmentActions {
  readonly onRemove: (id: string) => void;
  readonly onAddPath: () => void;
  readonly onDropFiles: (files: ReadonlyArray<File>) => void;
}

export function TaskAttachmentStrip({
  attachments,
  actions,
}: {
  attachments: ReadonlyArray<TaskAttachmentView>;
  actions: TaskAttachmentActions | null;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-md border border-border pl-1 pr-0.5 text-xs"
        >
          {attachment.kind === "image" ? (
            <img
              src={attachment.previewUrl}
              alt=""
              className="size-5 shrink-0 rounded-sm object-cover"
            />
          ) : attachment.isDirectory ? (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={
                    attachment.kind === "path" && attachment.state === "missing"
                      ? "min-w-0 truncate text-destructive-foreground line-through"
                      : "min-w-0 truncate"
                  }
                />
              }
            >
              {attachment.kind === "image" ? attachment.name : attachment.path}
            </TooltipTrigger>
            <TooltipPopup>
              {attachment.kind === "path" && attachment.state === "missing"
                ? `Missing: ${attachment.path}`
                : attachment.kind === "image"
                  ? attachment.name
                  : attachment.path}
            </TooltipPopup>
          </Tooltip>
          {attachment.sizeBytes !== null ? (
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatBytes(attachment.sizeBytes)}
            </span>
          ) : null}
          {actions ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Remove ${attachment.kind === "image" ? attachment.name : attachment.path}`}
              onClick={() => actions.onRemove(attachment.id)}
            >
              <XIcon />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The paperclip count on list rows and board cards; nothing when the task has no attachments. */
export function TaskAttachmentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      aria-label={`${count} ${count === 1 ? "attachment" : "attachments"}`}
      className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums"
    >
      <PaperclipIcon className="size-3" />
      {count}
    </span>
  );
}
