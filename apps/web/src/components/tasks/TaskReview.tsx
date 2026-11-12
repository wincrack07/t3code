import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { CommandId, type ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, FileDiffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { cn, randomUUID } from "../../lib/utils";
import { useQuietThreadShell, useThreadProjection } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useTaskThread } from "./TaskParts";
import {
  TASK_TEXT_MAX_LENGTH,
  taskReviewToReconcile,
  taskReviewView,
  taskThreadRefs,
  type TaskEntry,
  type TaskProjectGroup,
} from "./tasks.logic";

/** The settled attempt in short: outcome, the reply's opening, change stats and pull requests. */
export function TaskReviewSummary({
  entry,
  density,
}: {
  entry: TaskEntry;
  density: "card" | "detail";
}) {
  const snapshot = entry.task.review;
  if (!snapshot) return null;
  const view = taskReviewView(snapshot);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge variant={view.tone} size="sm">
          {view.outcome}
        </Badge>
        {view.changes ? (
          <Badge
            variant="outline"
            size="sm"
            aria-label={`${view.changes.files} files changed, ${view.changes.label}`}
          >
            <FileDiffIcon />
            <span className="tabular-nums">{view.changes.label}</span>
          </Badge>
        ) : null}
        {view.pullRequests.map((pr) => (
          <Badge
            key={pr.url}
            variant="outline"
            size="sm"
            render={
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Pull request #${pr.number}${pr.state ? `, ${pr.state}` : ""}`}
              />
            }
          >
            <PrGlyph state={pr.state} />#{pr.number}
          </Badge>
        ))}
        {density === "detail" && view.duration ? (
          <span className="text-xs text-muted-foreground tabular-nums">{view.duration}</span>
        ) : null}
      </div>
      {view.excerpt ? (
        <p
          className={cn(
            "text-xs leading-4 text-muted-foreground",
            density === "card" ? "line-clamp-2" : "line-clamp-4",
          )}
        >
          {view.excerpt}
        </p>
      ) : null}
    </div>
  );
}

/** Approve marks the task done; Request changes sends a note to the same thread. */
export function TaskReviewActions({
  entry,
  showOpenThread,
}: {
  entry: TaskEntry;
  showOpenThread: boolean;
}) {
  const { allowed, update } = useSavedPrompts(entry.home.environmentId, entry.home.id);
  const navigate = useNavigate();
  const thread = taskThreadRefs(entry.task, entry.home.environmentId).latest;
  const [noting, setNoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    await update({ kind: "approve", id: entry.task.id });
    setBusy(false);
  };
  if (noting && thread)
    return <RequestChangesForm entry={entry} thread={thread} onDone={() => setNoting(false)} />;
  return (
    <div className="flex min-w-0 items-center gap-1">
      {showOpenThread && thread ? (
        <Button
          size="compact"
          variant="ghost"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(thread),
            })
          }
        >
          Open thread
          <ArrowUpRightIcon />
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="compact"
          variant="outline"
          disabled={!allowed || busy || !thread}
          onClick={() => setNoting(true)}
        >
          Request changes
        </Button>
        <Button size="compact" disabled={!allowed || busy} onClick={() => void approve()}>
          Approve
        </Button>
      </div>
    </div>
  );
}

function RequestChangesForm({
  entry,
  thread,
  onDone,
}: {
  entry: TaskEntry;
  thread: ScopedThreadRef;
  onDone: () => void;
}) {
  const shell = useQuietThreadShell(thread);
  const send = useAtomCommand(projectEnvironment.tasks.requestChanges);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = note.trim().length > 0 && note.length <= TASK_TEXT_MAX_LENGTH;
  const submit = async () => {
    if (!valid || busy || !shell) return;
    setBusy(true);
    const result = await send({
      source: {
        home: scopeProjectRef(entry.home.environmentId, entry.home.id),
        taskId: entry.task.id,
      },
      thread,
      commandId: CommandId.make(randomUUID()),
      note: note.trim(),
      turn: {
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        modelSelection: shell.modelSelection,
      },
    });
    setBusy(false);
    if (result._tag === "Success") onDone();
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Textarea
        size="sm"
        autoFocus
        aria-label="What should change"
        placeholder="What should change? Sent to the same thread."
        value={note}
        maxLength={TASK_TEXT_MAX_LENGTH}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <div className="flex items-center justify-end gap-1">
        {!shell ? (
          <span className="mr-auto truncate text-xs text-muted-foreground">Thread not loaded</span>
        ) : null}
        <Button size="compact" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="compact" disabled={!valid || busy || !shell} onClick={() => void submit()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A task whose thread ran on another machine reaches Review only when a client holding both
 * reports the result; this does that once the thread's machine has it loaded and idle.
 */
export function TaskReviewReconcilers({ groups }: { groups: ReadonlyArray<TaskProjectGroup> }) {
  return groups.flatMap((group) =>
    group.tasks
      .filter((entry) => entry.status === "in-progress")
      .map((entry) => <TaskReviewReconciler key={entry.key} entry={entry} />),
  );
}

function TaskReviewReconciler({ entry }: { entry: TaskEntry }) {
  const thread = useTaskThread(entry);
  const ref = taskReviewToReconcile(entry, thread.state);
  return ref ? <ReconcileThread entry={entry} threadRef={ref} /> : null;
}

function ReconcileThread({ entry, threadRef }: { entry: TaskEntry; threadRef: ScopedThreadRef }) {
  const detail = useThreadProjection(threadRef);
  const reconcile = useAtomCommand(projectEnvironment.tasks.reconcileReview, {
    reportFailure: false,
  });
  const sent = useRef<string | null>(null);
  const homeEnvironmentId = entry.home.environmentId;
  const homeProjectId = entry.home.id;
  const taskId = entry.task.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports a settled run on another machine to the task's machine once per run state; the server dedupes by command id
  useEffect(() => {
    const run = detail?.projection.runs.at(-1);
    if (!detail || !run) return;
    const key = `${run.id}:${run.status}`;
    if (sent.current === key) return;
    sent.current = key;
    void reconcile({
      source: { home: scopeProjectRef(homeEnvironmentId, homeProjectId), taskId },
      thread: threadRef,
      projection: detail.projection,
    });
  }, [detail, reconcile, homeEnvironmentId, homeProjectId, taskId, threadRef]);
  return null;
}

function PrGlyph({ state }: { state: "open" | "closed" | "merged" | undefined }) {
  const Glyph =
    state === "merged"
      ? PullRequestGlyph.merged
      : state === "closed"
        ? PullRequestGlyph.closed
        : PullRequestGlyph.pullRequest;
  return <Glyph />;
}
