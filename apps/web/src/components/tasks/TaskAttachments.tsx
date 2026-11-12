import type { EnvironmentId } from "@t3tools/contracts";
import { AlertTriangleIcon, FileIcon, FolderIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { TaskAttachmentView, TaskReferenceState } from "./tasks.logic";

const REFERENCE_STATE_LABELS: Record<TaskReferenceState, string> = {
  ok: "available",
  missing: "missing",
  unavailable: "not checked",
};

export function TaskAttachmentStrip({
  environmentId,
  attachments,
  onRemove,
}: {
  environmentId: EnvironmentId;
  attachments: ReadonlyArray<TaskAttachmentView>;
  onRemove: ((key: string) => void) | null;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {attachments.map((attachment) => (
        <li
          key={attachment.key}
          className="flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-md border border-border pl-1 pr-0.5 text-xs"
        >
          {attachment.image ? (
            <TaskImageThumbnail environmentId={environmentId} {...attachment.image} />
          ) : attachment.kind === "folder" ? (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "min-w-0 truncate",
                    attachment.missing && "text-destructive-foreground line-through",
                  )}
                />
              }
            >
              {attachment.name}
            </TooltipTrigger>
            <TooltipPopup>
              <span className="block max-w-96 break-all">
                {attachment.missing ? "Missing: " : ""}
                {attachment.detail}
              </span>
              {attachment.machines.map((machine) => (
                <span key={machine.label} className="block">
                  On {machine.label}: {REFERENCE_STATE_LABELS[machine.state]}
                </span>
              ))}
            </TooltipPopup>
          </Tooltip>
          {attachment.warning ? (
            <Tooltip>
              <TooltipTrigger
                render={<span role="img" aria-label={attachment.warning} className="shrink-0" />}
              >
                <AlertTriangleIcon className="size-3.5 text-warning-foreground" />
              </TooltipTrigger>
              <TooltipPopup>{attachment.warning}</TooltipPopup>
            </Tooltip>
          ) : null}
          {attachment.sizeBytes !== null ? (
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatBytes(attachment.sizeBytes)}
            </span>
          ) : null}
          {onRemove ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.key)}
            >
              <XIcon />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TaskImageThumbnail({
  environmentId,
  attachmentId,
  mimeType,
}: {
  environmentId: EnvironmentId;
  attachmentId: string;
  mimeType: string;
}) {
  const url = useAssetUrlState(environmentId, {
    _tag: "attachment",
    attachmentId,
    mimeType,
    disposition: "inline",
  });
  return url._tag === "Success" ? (
    <img src={url.url} alt="" className="size-5 shrink-0 rounded-sm object-cover" />
  ) : (
    <span className="size-5 shrink-0 rounded-sm bg-muted" />
  );
}

/** An absolute path on the task's machine; files in temporary folders are copied when added. */
export function TaskAddPathForm({
  machineLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  machineLabel: string;
  busy: boolean;
  onSubmit: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState("");
  const trimmed = path.trim();
  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <Input
        size="compact"
        autoFocus
        aria-label={`File or folder path on ${machineLabel}`}
        placeholder={`Absolute path on ${machineLabel}`}
        className="min-w-0 flex-1"
        value={path}
        onChange={(event) => setPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button size="compact" type="submit" disabled={!trimmed || busy}>
        {busy ? "Adding…" : "Add"}
      </Button>
      <Button size="compact" variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </Button>
    </form>
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
