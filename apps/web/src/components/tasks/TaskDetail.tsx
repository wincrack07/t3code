import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CommandId, type EnvironmentId, type SavedPromptStatus } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LinkIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  WandIcon,
} from "lucide-react";
import { type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn, randomUUID } from "../../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { launchTaskThread } from "../../state/tasks";
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
import { TaskAttachmentStrip, type TaskAttachmentActions } from "./TaskAttachments";
import {
  TASK_THREAD_STATE_LABELS,
  TaskMachineChip,
  TaskStatusMenu,
  TaskThreadDot,
  useTaskThread,
} from "./TaskParts";
import {
  TASK_POLISH_MAX_LENGTH,
  TASK_TEXT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  taskThreadLink,
  taskTitle,
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
  attachmentActions = null,
}: {
  entry: TaskEntry;
  group: TaskProjectGroup;
  density?: TaskDetailDensity;
  attachmentActions?: TaskAttachmentActions | null;
}) {
  const { task, home } = entry;
  const environmentId = home.environmentId;
  const projectId = home.id;
  const compact = density === "compact";
  const { allowed, update } = useSavedPrompts(environmentId, projectId);
  const labelOf = useEnvironmentLabel();
  const thread = useTaskThread(entry);
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
    if (!(await update({ kind: "delete", id: task.id }))) return;
    toastManager.add({
      type: "success",
      title: "Task deleted",
      actionProps: {
        children: "Undo",
        onClick: () =>
          void update({
            kind: "add",
            id: task.id,
            text: text.trim() || task.text,
            title: trimmedTitle,
            status: entry.status,
          }),
      },
    });
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
  const startThread = async (send: boolean) => {
    if (!(await save())) return;
    await start.run(send, text.trim());
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
              {attachmentActions ? (
                <MenuItem onClick={attachmentActions.onAddPath}>Add file or folder path</MenuItem>
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
      {compact ? null : (
        <div className="-mt-2 flex h-4 min-w-0 items-center gap-3 px-1">
          <TaskMachineChip label={labelOf(environmentId)} />
        </div>
      )}
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
          {...(attachmentActions
            ? {
                onDrop: (event: DragEvent<HTMLTextAreaElement>) => {
                  if (event.dataTransfer.files.length === 0) return;
                  event.preventDefault();
                  attachmentActions.onDropFiles([...event.dataTransfer.files]);
                },
                onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
                  if (event.clipboardData.files.length === 0) return;
                  event.preventDefault();
                  attachmentActions.onDropFiles([...event.clipboardData.files]);
                },
              }
            : {})}
        />
      </div>
      <TaskAttachmentStrip attachments={[]} actions={attachmentActions} />
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
      {thread.state !== null ? (
        thread.shell ? (
          <button
            type="button"
            className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(scopeThreadRef(environmentId, thread.shell!.id)),
              })
            }
          >
            <TaskThreadDot state={thread.state} />
            <span className="min-w-0 flex-1 truncate">{thread.shell.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {TASK_THREAD_STATE_LABELS[thread.state]}
            </span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <p className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
            <TaskThreadDot state="missing" />
            The linked thread is archived or not loaded.
          </p>
        )
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
                  homeEnvironmentId={environmentId}
                  labelOf={labelOf}
                />
              </MenuPopup>
            </Menu>
          </Group>
        </div>
      </div>
    </section>
  );
}

/** Where a task's thread runs. Only its own machine until the backend links threads across machines. */
function StartMachineItems({
  group,
  homeEnvironmentId,
  labelOf,
}: {
  group: TaskProjectGroup;
  homeEnvironmentId: EnvironmentId;
  labelOf: (environmentId: EnvironmentId) => string;
}) {
  const others = [
    ...new Set(
      group.members
        .map((member) => member.project.environmentId)
        .filter((environmentId) => environmentId !== homeEnvironmentId),
    ),
  ];
  return (
    <MenuGroup>
      <MenuGroupLabel>Runs on</MenuGroupLabel>
      <MenuItem disabled>
        {labelOf(homeEnvironmentId)}
        <MenuItemDetail>Task's machine</MenuItemDetail>
      </MenuItem>
      {others.map((environmentId) => (
        <MenuItem key={environmentId} disabled>
          {labelOf(environmentId)}
        </MenuItem>
      ))}
      {others.length > 0 ? (
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          A task's thread runs on the machine that stores the task. Other machines need a server
          update before they can start it.
        </p>
      ) : null}
    </MenuGroup>
  );
}

/** Start a thread from the task on its machine, or open it in a new composer draft. */
function useTaskStart(entry: TaskEntry) {
  const { home, task } = entry;
  const environmentId = home.environmentId;
  const newThread = useNewThreadHandler();
  const launch = useAtomCommand(launchTaskThread);
  const allowed = useAtomValue(launchTaskThread.permissionAtom(environmentId));
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const openInComposer = async (prompt: string) => {
    const result = await newThread(scopeProjectRef(environmentId, home.id), { prompt });
    if (!result) return;
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(result.draftId)?.prompt;
    if (existing !== prompt) {
      store.setPrompt(result.draftId, [existing, prompt].filter(Boolean).join("\n\n"));
    }
  };
  const run = async (send: boolean, prompt: string) => {
    if (!send) return openInComposer(prompt);
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    if (!config) {
      toastManager.add({ type: "error", title: "This task's machine is not connected" });
      return;
    }
    const settings = resolveProjectSettings(config.settings, home.id, home).settings;
    const selection = resolveNewThreadModelSelection({
      defaultSelection:
        settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(config.providers, config.settings, home.id),
      fallbackSelection: settings.fallbackModelSelection,
      providers: config.providers,
      settings: config.settings,
      projectId: home.id,
      now: Date.now(),
    }).selection;
    if (!selection) {
      toastManager.add({ type: "error", title: "Choose a default model in project settings" });
      return;
    }
    setBusy(true);
    const result = await launch({
      environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        projectId: home.id,
        savedPromptId: task.id,
        title: task.title ?? taskTitle(task),
        modelSelection: selection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
      },
    });
    setBusy(false);
    if (result._tag !== "Success") return;
    const threadRef = scopeThreadRef(environmentId, result.value.threadId);
    toastManager.add({
      type: "success",
      title: "Thread started",
      actionProps: {
        children: "Open",
        onClick: () =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
          }),
      },
    });
  };
  return { allowed, busy, run };
}
