import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { SavedTaskLinkReceipt } from "@t3tools/client-runtime/state/tasks";
import {
  CommandId,
  type EnvironmentId,
  type SavedPromptStatus,
  type TaskAttachmentInput,
  taskAttachmentKey,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  LinkIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  WandIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn, newThreadId, randomUUID } from "../../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { taskDrafts } from "../../state/taskDrafts";
import {
  composerAttachmentsFromTask,
  isTaskImageFile,
  setTaskLinkReceipt,
  taskAttachmentInputsFromFiles,
  taskLinkReceiptsAtom,
} from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { usePromptPolish } from "../chat/usePromptPolish";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskAddPathForm, TaskAttachmentCount, TaskAttachmentStrip } from "./TaskAttachments";
import { TASK_PRIORITY_BADGE, TASK_WHEN_ORDER, TaskChoiceChip, TaskTagsEditor } from "./TaskFields";
import { TaskMachineChip, TaskStatusMenu, TaskThreadRow } from "./TaskParts";
import { TaskReviewActions, TaskReviewSummary } from "./TaskReview";
import {
  type InspectedTaskAttachment,
  pendingTaskLink,
  TASK_POLISH_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_WHEN_LABELS,
  taskPriority,
  taskWhen,
  TASK_TEXT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  taskAttachmentLimitError,
  taskAttachmentViews,
  taskStartTargets,
  taskThreadLink,
  taskThreadRefs,
  taskTitle,
  type TaskAttachmentCandidate,
  type TaskEntry,
  type TaskProjectGroup,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

export type TaskDetailDensity = "page" | "compact";

/** The one task editor: the Tasks page, the board's detail pane and the chat's quick panel. */
export function TaskDetail({
  entry,
  group,
  density = "page",
  tagsInUse,
  startAddingTag = false,
  onAddingTagChange,
}: {
  entry: TaskEntry;
  group: TaskProjectGroup;
  density?: TaskDetailDensity;
  tagsInUse: ReadonlyArray<string>;
  /** The row menu's "New tag…" opens the tag field. */
  startAddingTag?: boolean;
  onAddingTagChange?: (adding: boolean) => void;
}) {
  const { task, home } = entry;
  const environmentId = home.environmentId;
  const projectId = home.id;
  const compact = density === "compact";
  const { allowed, update, attempt } = useSavedPrompts(environmentId, projectId);
  const labelOf = useEnvironmentLabel();
  const threads = taskThreadRefs(task, environmentId);
  const [showPrevious, setShowPrevious] = useState(false);
  const pendingLink = pendingTaskLink(
    useAtomValue(taskLinkReceiptsAtom)[entry.key],
    task,
    environmentId,
  );
  const attachments = useTaskAttachments(entry, group);
  const navigate = useNavigate();
  const [text, setText] = useState(task.text);
  const [title, setTitle] = useState(task.title ?? "");
  const [source, setSource] = useState(task);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  // The text an accepted polish replaced; offered back until the next edit.
  const [beforePolish, setBeforePolish] = useState<string | null>(null);
  const promptRef = useRef(text);
  const polish = usePromptPolish({ environmentId, projectId, promptRef, reviewsResult: true });
  const start = useTaskStart(entry);
  const [addingTag, setAddingTag] = useState(startAddingTag);
  const [tagRequest, setTagRequest] = useState(startAddingTag);
  if (tagRequest !== startAddingTag) {
    setTagRequest(startAddingTag);
    if (startAddingTag) setAddingTag(true);
  }
  const changeAddingTag = (adding: boolean) => {
    setAddingTag(adding);
    onAddingTagChange?.(adding);
  };
  // Another window or machine edited the task: take its text unless this editor changed it too.
  if (source.text !== task.text || source.title !== task.title) {
    if (text === source.text) setText(task.text);
    if (title === (source.title ?? "")) setTitle(task.title ?? "");
    setSource(task);
  }
  const trimmedTitle = title.trim() || null;
  const dirty = text.trim() !== task.text || trimmedTitle !== (task.title ?? null);
  const valid =
    text.trim().length > 0 &&
    text.length <= TASK_TEXT_MAX_LENGTH &&
    title.length <= TASK_TITLE_MAX_LENGTH;
  const save = useStableCallback(async () => {
    if (!allowed || !dirty || !valid) return !dirty;
    setSaving(true);
    const ok = await update({ kind: "edit", id: task.id, text: text.trim(), title: trimmedTitle });
    setSaving(false);
    setFailed(!ok);
    return ok;
  });
  // Restarting the timer on every keystroke saves once typing pauses, not once per change.
  const pendingEdit = dirty && valid && !failed ? `${title}\u0000${text}` : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the editor draft to the task's machine after typing pauses
  useEffect(() => {
    if (pendingEdit === null) return;
    const timer = window.setTimeout(() => void save(), 600);
    return () => window.clearTimeout(timer);
  }, [pendingEdit, save]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- flushes a pending edit when the editor leaves the page or panel
  useEffect(() => () => void save(), [save]);

  const changeText = (value: string) => {
    promptRef.current = value;
    setText(value);
    setFailed(false);
  };
  const runPolish = () => {
    promptRef.current = text;
    void polish.polish((expected, next) => {
      if (promptRef.current !== expected) return false;
      setReview(next);
      return true;
    });
  };
  const changeStatus = (status: SavedPromptStatus) =>
    void update({ kind: "edit", id: task.id, status });
  const remove = async () => {
    // Pending typing would otherwise be lost: restore brings back the stored record.
    await save();
    if (!(await update({ kind: "delete", id: task.id }))) return;
    toastManager.add({
      type: "success",
      title: "Task deleted",
      actionProps: {
        children: "Undo",
        onClick: () => void update({ kind: "restore", id: task.id }),
      },
    });
  };
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [addingPath, setAddingPath] = useState(false);
  const canAttach = allowed && !compact;
  const attach = async (
    candidates: ReadonlyArray<TaskAttachmentCandidate>,
    prepare: () => Promise<{ inputs: TaskAttachmentInput[]; release: () => void }>,
  ) => {
    const limit = taskAttachmentLimitError(task.attachments ?? [], candidates);
    setAttachError(limit);
    if (limit !== null) return false;
    setAttaching(true);
    const prepared = await prepare().catch((error: unknown) => {
      setAttachError(error instanceof Error ? error.message : "Could not read the attachment.");
      return null;
    });
    if (!prepared) {
      setAttaching(false);
      return false;
    }
    const refusal = await attempt({ kind: "attach", id: task.id, attachments: prepared.inputs });
    prepared.release();
    setAttaching(false);
    setAttachError(refusal);
    return refusal === null;
  };
  const attachFiles = (files: ReadonlyArray<File>) =>
    void attach(
      files.map((file) => ({
        name: file.name,
        kind: isTaskImageFile(file) ? "image" : "file",
        sizeBytes: file.size,
      })),
      () => taskAttachmentInputsFromFiles(environmentId, files),
    );
  const attachPath = async (path: string) => {
    if (
      await attach([{ name: path, kind: "path", sizeBytes: 0 }], async () => ({
        inputs: [{ kind: "path", path }],
        release: () => {},
      }))
    )
      setAddingPath(false);
  };
  const removeAttachment = async (key: string) =>
    setAttachError(await attempt({ kind: "remove-attachment", id: task.id, key }));
  const onDataTransfer = (data: DataTransfer, preventDefault: () => void) => {
    if (!canAttach || data.files.length === 0) return;
    preventDefault();
    if ([...data.items].some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      setAttachError("Add folders with Add file or folder path.");
      return;
    }
    attachFiles([...data.files]);
  };
  const link = taskThreadLink(text.trim(), window.location.origin);
  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toastManager.add({ type: "success", title: "Link copied" });
    } catch {
      toastManager.add({ type: "error", title: "Could not copy the link" });
    }
  };
  const busy = start.busy;
  const canStart = allowed && start.allowed && valid && !busy && review === null;
  const startThread = async (send: boolean, target: EnvironmentProject = home) => {
    if (!(await save())) return;
    await start.run(send, target);
  };
  const counter = (review ?? text).length;
  const polishTooLong = text.length > TASK_POLISH_MAX_LENGTH;
  const note = !allowed
    ? "View only"
    : failed
      ? "Could not save"
      : saving
        ? "Saving…"
        : dirty
          ? "Unsaved changes"
          : "Saved automatically";

  return (
    <section
      aria-label="Task details"
      className={cn("flex min-h-0 min-w-0 flex-col", compact ? "gap-2" : "h-full gap-3 p-4")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <input
          aria-label="Task title"
          className={cn(
            "h-8 min-w-0 flex-1 basis-48 text-ellipsis rounded-md bg-transparent px-1 font-medium outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-64",
            compact ? "text-sm" : "text-base",
          )}
          placeholder={taskTitle({ ...task, title: null })}
          maxLength={TASK_TITLE_MAX_LENGTH}
          value={title}
          disabled={!allowed}
          onChange={(event) => {
            setTitle(event.target.value);
            setFailed(false);
          }}
          onBlur={() => void save()}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {compact ? null : (
            <Badge variant="outline" size="control" className="min-w-0 max-w-48">
              <span className="truncate">{group.label}</span>
            </Badge>
          )}
          <TaskStatusMenu status={entry.status} disabled={!allowed} onChange={changeStatus} />
          <Menu>
            <MenuTrigger
              render={<Button size="icon-sm" variant="ghost-muted" aria-label="Task actions" />}
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem disabled={link === null} onClick={() => void copyLink()}>
                <LinkIcon />
                Copy link
                {link === null ? <MenuItemDetail>Too long for a link</MenuItemDetail> : null}
              </MenuItem>
              {canAttach ? (
                <MenuItem onClick={() => setAddingPath(true)}>
                  <FolderPlusIcon />
                  Add file or folder path
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem variant="destructive" disabled={!allowed} onClick={() => void remove()}>
                <Trash2Icon />
                Delete task
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5">
        <TaskChoiceChip
          label="Priority"
          value={taskPriority(task)}
          variant={TASK_PRIORITY_BADGE[taskPriority(task)]}
          options={TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] }))}
          disabled={!allowed}
          onChange={(priority) => void update({ kind: "edit", id: task.id, priority })}
        />
        <TaskChoiceChip
          label="When"
          value={taskWhen(task)}
          options={TASK_WHEN_ORDER.map((value) => ({ value, label: TASK_WHEN_LABELS[value] }))}
          disabled={!allowed}
          onChange={(when) => void update({ kind: "edit", id: task.id, when })}
        />
        <TaskTagsEditor
          tags={task.tags ?? []}
          suggestions={tagsInUse}
          disabled={!allowed}
          adding={addingTag}
          onAddingChange={changeAddingTag}
          onChange={(tags) => void update({ kind: "edit", id: task.id, tags })}
        />
        {compact ? null : (
          <span className="ml-auto flex min-w-0 max-w-40">
            <TaskMachineChip label={labelOf(environmentId)} />
          </span>
        )}
      </div>
      {entry.status === "review" && task.review ? (
        <section
          aria-label="Result"
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3"
        >
          <TaskReviewSummary entry={entry} density="detail" />
          <TaskReviewActions entry={entry} showOpenThread />
        </section>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-col rounded-lg border border-border has-focus-visible:border-ring",
          compact ? "h-48" : "flex-1",
        )}
      >
        {review !== null ? (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1 text-xs">
            <WandIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Polished version. Keep it or go back to yours.
            </span>
            <Button size="compact" variant="ghost" onClick={() => setReview(null)}>
              Revert
            </Button>
            <Button
              size="compact"
              disabled={review.length > TASK_TEXT_MAX_LENGTH || !review.trim()}
              onClick={() => {
                const previous = text;
                changeText(review);
                setBeforePolish(previous);
                setReview(null);
              }}
            >
              Accept
            </Button>
          </div>
        ) : null}
        <textarea
          aria-label="Task prompt"
          className="min-h-0 flex-1 resize-none rounded-lg bg-transparent px-3 py-2.5 text-sm leading-6 outline-none read-only:text-muted-foreground"
          value={review ?? text}
          readOnly={review !== null}
          maxLength={TASK_TEXT_MAX_LENGTH}
          disabled={!allowed}
          onChange={(event) => {
            changeText(event.target.value);
            setBeforePolish(null);
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canStart) {
              event.preventDefault();
              void startThread(true);
            }
          }}
          onDragOver={(event) => {
            if (canAttach && event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => onDataTransfer(event.dataTransfer, () => event.preventDefault())}
          onPaste={(event) => onDataTransfer(event.clipboardData, () => event.preventDefault())}
        />
      </div>
      {compact ? (
        attachments.views.length > 0 ? (
          <div className="flex h-7 min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
            <TaskAttachmentCount count={attachments.views.length} />
            <span className="min-w-0 truncate">Manage attachments in Tasks</span>
            <Button
              size="micro"
              variant="ghost"
              onClick={() =>
                void navigate({ to: "/tasks", search: { project: group.key, task: entry.key } })
              }
            >
              Open
            </Button>
          </div>
        ) : null
      ) : (
        <>
          <TaskAttachmentStrip
            environmentId={environmentId}
            attachments={attachments.views}
            onRemove={canAttach ? (key) => void removeAttachment(key) : null}
          />
          {addingPath ? (
            <TaskAddPathForm
              machineLabel={labelOf(environmentId)}
              busy={attaching}
              onSubmit={(path) => void attachPath(path)}
              onCancel={() => {
                setAddingPath(false);
                setAttachError(null);
              }}
            />
          ) : null}
          {attaching && !addingPath ? (
            <p className="px-1 text-xs text-muted-foreground" role="status">
              Attaching…
            </p>
          ) : null}
          {attachError ? (
            <p role="alert" className="px-1 text-xs text-destructive-foreground">
              {attachError}
            </p>
          ) : null}
        </>
      )}
      <div
        className="flex h-4 items-center justify-between gap-2 px-1 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span className="flex min-w-0 items-center gap-1 truncate">
          {note}
          {failed ? (
            <Button
              size="micro"
              variant="ghost"
              onClick={() => {
                setFailed(false);
                void save();
              }}
            >
              Retry
            </Button>
          ) : null}
        </span>
        <span className="shrink-0 tabular-nums">
          {counter.toLocaleString()} / {TASK_TEXT_MAX_LENGTH.toLocaleString()}
        </span>
      </div>
      {pendingLink ? (
        <PendingLinkRow
          receipt={pendingLink}
          taskKey={entry.key}
          machineLabel={labelOf(pendingLink.thread.environmentId)}
        />
      ) : null}
      {threads.latest ? (
        <TaskThreadRow
          threadRef={threads.latest}
          machineLabel={
            threads.latest.environmentId === environmentId
              ? null
              : labelOf(threads.latest.environmentId)
          }
        />
      ) : null}
      {threads.previous.length > 0 ? (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            aria-expanded={showPrevious}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => setShowPrevious(!showPrevious)}
          >
            <ChevronRightIcon className={cn("size-3.5 shrink-0", showPrevious && "rotate-90")} />
            Previous threads <span className="tabular-nums">· {threads.previous.length}</span>
          </button>
          {showPrevious
            ? threads.previous.map((ref) => (
                <TaskThreadRow
                  key={`${ref.environmentId}:${ref.threadId}`}
                  threadRef={ref}
                  machineLabel={labelOf(ref.environmentId)}
                />
              ))
            : null}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-1">
        {polishTooLong ? (
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="rounded-md" />}>
              <Button size="compact" variant="ghost" disabled>
                <WandIcon />
                Polish
              </Button>
            </TooltipTrigger>
            <TooltipPopup>
              Polish rewrites prompts up to {TASK_POLISH_MAX_LENGTH.toLocaleString()} characters.
            </TooltipPopup>
          </Tooltip>
        ) : (
          <Button
            size="compact"
            variant="ghost"
            disabled={!allowed || !polish.available || polish.running || !valid || review !== null}
            onClick={runPolish}
          >
            <WandIcon />
            {polish.running ? "Polishing…" : "Polish"}
          </Button>
        )}
        {beforePolish !== null ? (
          <Button
            size="compact"
            variant="ghost-muted"
            onClick={() => {
              changeText(beforePolish);
              setBeforePolish(null);
            }}
          >
            Undo polish
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Group aria-label="Start thread">
            <Button size="compact" disabled={!canStart} onClick={() => void startThread(true)}>
              {busy ? "Starting…" : "Start thread"}
            </Button>
            <GroupSeparator />
            <Menu>
              <MenuTrigger
                disabled={!valid || busy || review !== null}
                render={<Button size="compact" aria-label="More ways to start" />}
              >
                <ChevronDownIcon />
              </MenuTrigger>
              <MenuPopup align="end" className="max-w-72">
                <MenuItem onClick={() => void startThread(false)}>Open without sending</MenuItem>
                <MenuSeparator />
                <StartMachineItems
                  group={group}
                  entry={entry}
                  labelOf={labelOf}
                  onStart={(target) => void startThread(true, target)}
                />
              </MenuPopup>
            </Menu>
          </Group>
        </div>
      </div>
    </section>
  );
}

/** Where a task's thread runs: its own machine, or another machine with the same project. */
function StartMachineItems({
  group,
  entry,
  labelOf,
  onStart,
}: {
  group: TaskProjectGroup;
  entry: TaskEntry;
  labelOf: (environmentId: EnvironmentId) => string;
  onStart: (target: EnvironmentProject) => void;
}) {
  const targets = taskStartTargets(group, entry, labelOf);
  if (targets.length < 2) return null;
  return (
    <MenuGroup>
      <MenuGroupLabel>Start on</MenuGroupLabel>
      {targets.map((target) => (
        <StartMachineItem
          key={target.project.environmentId}
          label={labelOf(target.project.environmentId)}
          environmentId={target.project.environmentId}
          detail={target.home ? "Task's machine" : target.disabledReason}
          disabled={target.disabledReason !== null}
          onClick={() => onStart(target.project)}
        />
      ))}
    </MenuGroup>
  );
}

function StartMachineItem({
  label,
  environmentId,
  detail,
  disabled,
  onClick,
}: {
  label: string;
  environmentId: EnvironmentId;
  detail: string | null;
  disabled: boolean;
  onClick: () => void;
}) {
  const allowed = useAtomValue(projectEnvironment.tasks.launch.permissionAtom(environmentId));
  return (
    <MenuItem disabled={disabled || !allowed} onClick={onClick}>
      <span className="min-w-0 truncate">{label}</span>
      {detail !== null || !allowed ? (
        <MenuItemDetail>{!allowed && detail === null ? "No permission" : detail}</MenuItemDetail>
      ) : null}
    </MenuItem>
  );
}

/** "Started, not linked": the thread exists, only the task's record of it failed. */
function PendingLinkRow({
  receipt,
  taskKey,
  machineLabel,
}: {
  receipt: SavedTaskLinkReceipt;
  taskKey: string;
  machineLabel: string;
}) {
  const retry = useAtomCommand(projectEnvironment.tasks.retryLink);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 px-2 text-xs" role="status">
      <AlertTriangleIcon className="size-3.5 shrink-0 text-warning-foreground" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Started on {machineLabel}, not linked to this task
      </span>
      <Button
        size="micro"
        variant="ghost"
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(receipt.thread),
          })
        }
      >
        Open
      </Button>
      <Button
        size="micro"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await retry(receipt);
          setBusy(false);
          if (result._tag === "Success") setTaskLinkReceipt(taskKey, null);
        }}
      >
        {busy ? "Linking…" : "Retry link"}
      </Button>
    </div>
  );
}

/** The task's attachments, checked on its machine and on every connected machine with the project. */
function useTaskAttachments(entry: TaskEntry, group: TaskProjectGroup) {
  const labelOf = useEnvironmentLabel();
  const inspect = useAtomCommand(projectEnvironment.tasks.attachments, { reportFailure: false });
  const [inspected, setInspected] = useState<{
    signature: string;
    items: ReadonlyArray<InspectedTaskAttachment>;
  } | null>(null);
  const homeEnvironmentId = entry.home.environmentId;
  const homeProjectId = entry.home.id;
  const taskId = entry.task.id;
  const list = entry.task.attachments ?? [];
  const checkKey = [
    ...new Set(
      group.members
        .filter((member) => member.reachable)
        .map((member) => member.project.environmentId),
    ),
  ].join("\n");
  const signature = JSON.stringify([entry.key, list.map(taskAttachmentKey), checkKey]);
  const empty = list.length === 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads file state from the task's machine whenever its attachments or reachable machines change
  useEffect(() => {
    if (empty) return;
    let live = true;
    void inspect({
      source: { home: scopeProjectRef(homeEnvironmentId, homeProjectId), taskId },
      checkEnvironmentIds: checkKey.split("\n") as EnvironmentId[],
    }).then((result) => {
      if (live && result._tag === "Success") setInspected({ signature, items: result.value });
    });
    return () => {
      live = false;
    };
  }, [inspect, empty, homeEnvironmentId, homeProjectId, taskId, checkKey, signature]);
  return {
    views: taskAttachmentViews({
      attachments: list,
      inspected: inspected?.signature === signature ? inspected.items : null,
      homeEnvironmentId,
      labelOf,
    }),
  };
}

function launchFailureToast(error: unknown, labelOf: (environmentId: EnvironmentId) => string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TaskAttachmentsHomeOnlyError" &&
    "homeEnvironmentId" in error
  ) {
    const home = labelOf(error.homeEnvironmentId as EnvironmentId);
    toastManager.add({
      type: "error",
      title: `Start this task on ${home}`,
      description: `Its attachments are stored on ${home}.`,
    });
    return;
  }
  toastManager.add({
    type: "error",
    title: "Could not start the thread",
    description:
      typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : undefined,
  });
}

/** Start a thread from the task on any machine with its project, or open it as a composer draft. */
function useTaskStart(entry: TaskEntry) {
  const { home, task } = entry;
  const newThread = useNewThreadHandler();
  const launch = useAtomCommand(projectEnvironment.tasks.launch, { reportFailure: false });
  const prepare = useAtomCommand(projectEnvironment.tasks.prepareDraft, { reportFailure: false });
  const allowed = useAtomValue(projectEnvironment.tasks.launch.permissionAtom(home.environmentId));
  const labelOf = useEnvironmentLabel();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const source = { home: scopeProjectRef(home.environmentId, home.id), taskId: task.id };
  const fail = (result: {
    readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
  }) => launchFailureToast(squashAtomCommandFailure(result), labelOf);
  const openInComposer = async (target: EnvironmentProject) => {
    setBusy(true);
    const prepared = await prepare({
      source,
      target: scopeProjectRef(target.environmentId, target.id),
    });
    if (prepared._tag !== "Success") {
      setBusy(false);
      if (!isAtomCommandInterrupted(prepared)) fail(prepared);
      return;
    }
    const files = await composerAttachmentsFromTask(
      home.environmentId,
      prepared.value.attachments,
    ).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not open the task's attachments",
        description: error instanceof Error ? error.message : undefined,
      });
      return null;
    });
    setBusy(false);
    if (!files) return;
    const prompt = prepared.value.text;
    const result = await newThread(scopeProjectRef(target.environmentId, target.id), { prompt });
    if (!result) return;
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(result.draftId)?.prompt;
    if (existing !== prompt) {
      store.setPrompt(result.draftId, [existing, prompt].filter(Boolean).join("\n\n"));
    }
    store.addImages(result.draftId, files.images);
    store.addFiles(result.draftId, files.files);
    // Sending this draft later links its thread back to the task.
    taskDrafts.set(scopeThreadRef(target.environmentId, result.threadId), source);
  };
  const run = async (send: boolean, target: EnvironmentProject) => {
    if (!send) return openInComposer(target);
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(target.environmentId);
    if (!config) {
      toastManager.add({
        type: "error",
        title: `${labelOf(target.environmentId)} is not connected`,
      });
      return;
    }
    const settings = resolveProjectSettings(config.settings, target.id, target).settings;
    const selection = resolveNewThreadModelSelection({
      defaultSelection:
        settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(config.providers, config.settings, target.id),
      fallbackSelection: settings.fallbackModelSelection,
      providers: config.providers,
      settings: config.settings,
      projectId: target.id,
      now: Date.now(),
    }).selection;
    if (!selection) {
      toastManager.add({ type: "error", title: "Choose a default model in project settings" });
      return;
    }
    setBusy(true);
    const result = await launch({
      source,
      target: scopeProjectRef(target.environmentId, target.id),
      launch: {
        commandId: CommandId.make(randomUUID()),
        // Stored copies are claimed for the new thread, so the server needs its id up front.
        threadId: newThreadId(),
        projectId: target.id,
        title: task.title ?? taskTitle(task),
        modelSelection: selection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
      },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      if (!isAtomCommandInterrupted(result)) fail(result);
      return;
    }
    const { receipt } = result.value;
    const open = {
      children: "Open",
      onClick: () =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(receipt.thread),
        }),
    };
    if (result.value.status === "started-not-linked") {
      setTaskLinkReceipt(entry.key, receipt);
      toastManager.add({
        type: "warning",
        title: "Thread started, not linked",
        description: "The task could not record it. Retry the link from the task.",
        actionProps: open,
      });
      return;
    }
    toastManager.add({ type: "success", title: "Thread started", actionProps: open });
  };
  return { allowed, busy, run };
}
