import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { CommandId, type ProjectSavedPrompt } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, Trash2Icon, WandIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { launchTaskThread } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { usePromptPolish } from "../chat/usePromptPolish";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { taskStatus, taskThreadRunning } from "./tasks.logic";

const STATUS_LABELS = { open: "Open", "in-progress": "In progress", done: "Done" } as const;

export function TaskDetail({
  task,
  project,
  compact = false,
}: {
  task: ProjectSavedPrompt;
  project: EnvironmentProject;
  compact?: boolean;
}) {
  const { environmentId, id: projectId } = project;
  const { allowed, update } = useSavedPrompts(environmentId, projectId);
  const navigate = useNavigate();
  const newThread = useNewThreadHandler();
  const launch = useAtomCommand(launchTaskThread);
  const canLaunch = useAtomValue(launchTaskThread.permissionAtom(environmentId));
  const [text, setText] = useState(task.text);
  const [title, setTitle] = useState(task.title ?? "");
  const [source, setSource] = useState(task);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const promptRef = useRef(text);
  const polish = usePromptPolish({ environmentId, projectId, promptRef });
  const linked = useThreadShell(
    task.latestThreadId ? scopeThreadRef(environmentId, task.latestThreadId) : null,
  );
  if (source.text !== task.text || source.title !== task.title) {
    if (text === source.text) setText(task.text);
    if (title === (source.title ?? "")) setTitle(task.title ?? "");
    setSource(task);
  }
  const dirty = text.trim() !== task.text || (title.trim() || null) !== (task.title ?? null);
  const valid = text.trim().length > 0 && text.length <= 120000 && title.length <= 160;
  const save = useStableCallback(async () => {
    if (!allowed || !dirty || !valid) return !dirty;
    setSaving(true);
    const ok = await update({
      kind: "edit",
      id: task.id,
      text: text.trim(),
      title: title.trim() || null,
    });
    setSaving(false);
    setFailed(!ok);
    return ok;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the editor draft to the environment after typing pauses
  useEffect(() => {
    if (
      (text.trim() === task.text && (title.trim() || null) === (task.title ?? null)) ||
      !valid ||
      failed
    )
      return;
    const timer = window.setTimeout(() => void save(), 600);
    return () => window.clearTimeout(timer);
  }, [valid, failed, text, title, task.text, task.title, save]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- flushes pending edits when this task editor leaves the page or panel
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );
  const changeText = (value: string) => {
    promptRef.current = value;
    setText(value);
    setFailed(false);
  };
  const openComposer = async () => {
    if (!(await save())) return;
    const result = await newThread(scopeProjectRef(environmentId, projectId), {
      prompt: text.trim(),
    });
    if (result) {
      const store = useComposerDraftStore.getState();
      const existing = store.getComposerDraft(result.draftId)?.prompt;
      if (existing !== text.trim())
        store.setPrompt(result.draftId, [existing, text.trim()].filter(Boolean).join("\n\n"));
    }
  };
  const start = async () => {
    if (busy || !(await save())) return;
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    if (!config) return;
    const settings = resolveProjectSettings(config.settings, projectId, project).settings;
    const selection = resolveNewThreadModelSelection({
      defaultSelection:
        settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(config.providers, config.settings, projectId),
      fallbackSelection: settings.fallbackModelSelection,
      providers: config.providers,
      settings: config.settings,
      projectId,
      now: Date.now(),
    }).selection;
    if (!selection) {
      toastManager.add({ type: "error", title: "Choose a default model in project settings" });
      return;
    }
    setBusy(true);
    await launch({
      environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        projectId,
        savedPromptId: task.id,
        title: title.trim() || "Task",
        modelSelection: selection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
      },
    });
    setBusy(false);
  };
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
            text: text.trim(),
            title: title.trim() || null,
            status: taskStatus(task),
          }),
      },
    });
  };
  return (
    <section aria-label="Task details" className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Input
            aria-label="Task title"
            size="compact"
            placeholder={task.text.split("\n")[0]?.slice(0, 160)}
            maxLength={160}
            value={title}
            disabled={!allowed}
            onChange={(event) => {
              setTitle(event.target.value);
              setFailed(false);
            }}
            onBlur={() => void save()}
          />
        </div>
        <Badge variant="secondary">{project.title}</Badge>
        <TaskStatusMenu
          status={taskStatus(task)}
          disabled={!allowed}
          onChange={(status) => void update({ kind: "edit", id: task.id, status })}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Delete task"
          disabled={!allowed || busy}
          onClick={() => void remove()}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className={compact ? "min-h-40" : "min-h-48 flex-1"}>
        <textarea
          aria-label="Task prompt"
          className="h-full min-h-40 w-full resize-none rounded-lg bg-transparent p-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          value={text}
          maxLength={120000}
          disabled={!allowed}
          onChange={(event) => changeText(event.target.value)}
          onBlur={() => void save()}
        />
      </div>
      <div className="flex justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span>
          {failed
            ? "Could not save. "
            : saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : "Saved automatically"}
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
        <span>{text.length.toLocaleString()} / 120,000</span>
      </div>
      {preview !== null ? (
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-xs font-medium">Polished preview</p>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm">
            {preview}
          </pre>
          <div className="flex justify-end gap-1">
            <Button size="compact" variant="ghost" onClick={() => setPreview(null)}>
              Revert
            </Button>
            <Button
              size="compact"
              disabled={preview.length > 120000 || !preview.trim()}
              onClick={() => {
                setUndo(text);
                changeText(preview);
                setPreview(null);
              }}
            >
              Accept
            </Button>
          </div>
        </div>
      ) : null}
      {linked ? (
        <Button
          size="compact"
          variant="ghost"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: linked.id },
            })
          }
        >
          {linked.title} ·{" "}
          {taskThreadRunning(linked.runtime?.status ?? linked.latestRun?.status)
            ? "Thread running"
            : "Thread finished"}
        </Button>
      ) : task.latestThreadId ? (
        <p className="text-xs text-muted-foreground">Linked thread is unavailable</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button
            size="compact"
            variant="ghost"
            disabled={!allowed || !polish.available || polish.running || !valid}
            onClick={() => {
              promptRef.current = text;
              void polish.polish((expected, next) => {
                if (promptRef.current !== expected) return false;
                setPreview(next);
                return true;
              });
            }}
          >
            <WandIcon />
            {polish.running ? "Polishing…" : "Polish"}
          </Button>
          {undo !== null ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => {
                changeText(undo);
                setUndo(null);
              }}
            >
              Undo polish
            </Button>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button
            size="compact"
            variant="ghost"
            disabled={!allowed || !valid || busy}
            onClick={() => void openComposer()}
          >
            Open in composer
          </Button>
          <div className="flex gap-px">
            <Button
              size="compact"
              disabled={!allowed || !canLaunch || !valid || busy}
              onClick={() => void start()}
            >
              {busy ? "Starting…" : "Start thread"}
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button size="icon-sm" aria-label="Thread options" disabled={!allowed || busy} />
                }
              >
                <ChevronDownIcon />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem onClick={() => void openComposer()}>Open without sending</MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskStatusMenu({
  status,
  disabled,
  onChange,
}: {
  status: keyof typeof STATUS_LABELS;
  disabled: boolean;
  onChange: (status: keyof typeof STATUS_LABELS) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="compact" variant="ghost" disabled={disabled} aria-label="Task status" />
        }
      >
        {STATUS_LABELS[status]}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <MenuItem key={value} onClick={() => onChange(value as keyof typeof STATUS_LABELS)}>
            {label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
