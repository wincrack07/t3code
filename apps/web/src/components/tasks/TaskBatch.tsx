import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommandId, type EnvironmentId, type ModelSelection } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { ListOrderedIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn, randomUUID } from "../../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentProviders } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  TASK_BATCH_DEFAULT_CONCURRENCY,
  TASK_BATCH_MAX_CONCURRENCY,
  TASK_RUN_WITH_ANCHOR,
  taskBatchSummary,
  taskQueueItems,
  taskQueueTotals,
  taskQueueView,
  taskRunProject,
  taskTitle,
  type TaskBatchPlanGroup,
  type TaskBatchSummary,
  type TaskEntry,
  type TaskProjectGroup,
  type TaskQueueView,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

/** "spread", "saved" (each task's own setting) or a machine's id. */
type Distribution = string;

const reachableProjects = (groups: ReadonlyArray<TaskProjectGroup>) =>
  groups.flatMap((group) =>
    group.members.filter((member) => member.reachable).map((member) => member.project),
  );

const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message ? error.message : "Try again.";
};

/** The launch fallback for tasks without saved settings, from the first task's project. */
function batchLaunchFallback(entry: TaskEntry, group: TaskProjectGroup) {
  const target = taskRunProject(entry, group);
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(target.environmentId);
  if (!config) return null;
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
  const modelSelection = entry.task.runSettings?.defaultModelSelection ?? selection;
  if (!modelSelection) return null;
  return {
    modelSelection,
    runtimeMode: settings.defaultRuntimeMode,
    interactionMode: "default" as const,
    ...(settings.defaultThreadEnvMode ? { threadEnvMode: settings.defaultThreadEnvMode } : {}),
  };
}

/** The provider's own name for a model, so the confirmation reads like the model picker. */
function useModelLabel() {
  const providers = useEnvironmentProviders();
  return (selection: ModelSelection) => {
    for (const list of providers.values()) {
      const model = list
        .find((provider) => provider.instanceId === selection.instanceId)
        ?.models.find((candidate) => candidate.slug === selection.model);
      if (model) return model.shortName ?? model.name;
    }
    return selection.model;
  };
}

type PreparedGroup = Extract<
  Awaited<ReturnType<typeof projectEnvironment.tasks.prepareBatch.run>>,
  { _tag: "Success" }
>["value"][number] &
  TaskBatchPlanGroup;

interface TaskBatchPlan {
  readonly groups: ReadonlyArray<PreparedGroup>;
  readonly summary: TaskBatchSummary;
}

/** Prepares a batch (where each task runs) and starts the prepared groups. */
function useTaskBatchRun(groups: ReadonlyArray<TaskProjectGroup>) {
  const prepare = useAtomCommand(projectEnvironment.tasks.prepareBatch, { reportFailure: false });
  const start = useAtomCommand(projectEnvironment.tasks.batchStart, { reportFailure: false });
  const labelOf = useEnvironmentLabel();
  const modelLabel = useModelLabel();
  const groupOf = (entry: TaskEntry) =>
    groups.find((group) => group.tasks.some((candidate) => candidate.key === entry.key))!;
  return {
    prepare: async (
      entries: ReadonlyArray<TaskEntry>,
      distribution: Distribution,
      concurrency: number,
    ): Promise<TaskBatchPlan | { error: string }> => {
      const first = entries[0];
      if (!first) return { error: "Select tasks to run." };
      const launch = batchLaunchFallback(first, groupOf(first));
      if (!launch) return { error: "Choose a default model in project settings." };
      const involved = [...new Set(entries.map(groupOf))];
      const result = await prepare({
        commandId: CommandId.make(randomUUID()),
        sources: entries.map((entry) => ({
          home: scopeProjectRef(entry.home.environmentId, entry.home.id),
          taskId: entry.task.id,
        })),
        targets: reachableProjects(involved).map((project) =>
          scopeProjectRef(project.environmentId, project.id),
        ),
        distribute: distribution === "spread",
        concurrency,
        launch,
        ...(distribution !== "spread" && distribution !== "saved"
          ? { overrides: { targetEnvironmentId: distribution as EnvironmentId } }
          : {}),
      });
      if (result._tag !== "Success") return { error: failureMessage(result) };
      return {
        groups: result.value,
        summary: taskBatchSummary(
          result.value,
          entries,
          {
            distribute: distribution === "spread",
            environmentId:
              distribution === "spread" || distribution === "saved"
                ? null
                : (distribution as EnvironmentId),
          },
          { machine: labelOf, model: modelLabel },
        ),
      };
    },
    /** Sends each prepared group's input unchanged; groups with nothing runnable are skipped. */
    start: async (plan: ReadonlyArray<PreparedGroup>) => {
      const runnable = plan.filter((group) => group.input.entries.length > 0);
      const results = await Promise.all(
        runnable.map((group) => start({ environmentId: group.environmentId, input: group.input })),
      );
      const failed = results.find((result) => result._tag !== "Success");
      return failed === undefined ? null : failureMessage(failed);
    },
  };
}

/** Opens a task with its Run with section in view, to pick a model it can be confirmed with. */
function useOpenRunWith() {
  const navigate = useNavigate();
  return (key: string) =>
    void navigate({
      to: "/tasks",
      search: (previous) => ({
        ...(previous.project ? { project: previous.project } : {}),
        task: key,
      }),
      hash: TASK_RUN_WITH_ANCHOR,
    });
}

/** What each task will run with, by machine, before anything starts. */
function TaskBatchConfirm({
  plan,
  starting,
  onConfirm,
  onClose,
}: {
  plan: TaskBatchPlan | null;
  starting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const openRunWith = useOpenRunWith();
  const runnable = plan?.summary.runnable ?? 0;
  const blocked = (plan?.summary.rows ?? []).flatMap((row) =>
    row.tasks.filter((task) => task.blocked !== null),
  );
  const reasons = [...new Set(blocked.map((task) => task.blocked))];
  return (
    <AlertDialog open={plan !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogPopup className="sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Run {runnable} {runnable === 1 ? "task" : "tasks"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block font-medium text-foreground tabular-nums">
              {plan?.summary.headline}
            </span>
            Each starts a paid agent turn with no one watching. Tasks past a machine&apos;s limit
            wait in a queue you can cancel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex max-h-80 min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-4">
          {plan?.summary.rows.map((row) => {
            const tasks = row.tasks.filter((task) => task.blocked === null);
            if (tasks.length === 0) return null;
            return (
              <section key={row.environmentId} aria-label={row.machine} className="flex flex-col">
                <h3 className="flex h-7 items-center gap-1 text-xs font-medium text-muted-foreground">
                  <span className="truncate">{row.machine}</span>
                  <span className="tabular-nums">· {tasks.length}</span>
                </h3>
                {row.capChange ? (
                  <p className="pb-1 text-xs text-muted-foreground">{row.capChange}</p>
                ) : null}
                <ul className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                  {tasks.map((item) => (
                    <li
                      key={item.key}
                      className="col-span-full grid h-8 min-w-0 grid-cols-subgrid items-center text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.title}</span>
                        {item.pinned ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={<span className="shrink-0 text-xs text-muted-foreground" />}
                            >
                              Pinned to its machine
                            </TooltipTrigger>
                            <TooltipPopup className="max-w-72">{item.pinned}</TooltipPopup>
                          </Tooltip>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "max-w-56 truncate text-xs",
                          item.modelDiffers
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.model} · {item.effort}
                      </span>
                      <span
                        className={cn(
                          "hidden text-xs sm:block",
                          item.accessDiffers
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.access}
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {item.workspace}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {blocked.length > 0 ? (
            <section aria-label="Will not run" className="flex flex-col">
              <h3 className="flex h-7 items-center gap-1 text-xs font-medium text-muted-foreground">
                Will not run
                <span className="tabular-nums">· {blocked.length}</span>
              </h3>
              {reasons.map((reason) => (
                <p key={reason} className="pb-1 text-xs text-muted-foreground">
                  {reason}
                </p>
              ))}
              <ul className="flex flex-col">
                {blocked.map((item) => (
                  <li key={item.key} className="flex h-8 min-w-0 items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {item.title}
                    </span>
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => {
                        onClose();
                        openRunWith(item.key);
                      }}
                    >
                      Choose a model
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button disabled={starting || runnable === 0} onClick={onConfirm}>
            {starting ? "Starting…" : `Start ${runnable}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** The selection bar: where to run, how many at once, and Run behind a confirmation. */
export function TaskBatchBar({
  groups,
  selected,
  onClear,
}: {
  groups: ReadonlyArray<TaskProjectGroup>;
  selected: ReadonlyArray<TaskEntry>;
  onClear: () => void;
}) {
  const labelOf = useEnvironmentLabel();
  const run = useTaskBatchRun(groups);
  const [distribution, setDistribution] = useState<Distribution>("saved");
  const [concurrency, setConcurrency] = useState(TASK_BATCH_DEFAULT_CONCURRENCY);
  const [preparing, setPreparing] = useState(false);
  const [plan, setPlan] = useState<TaskBatchPlan | null>(null);
  const [starting, setStarting] = useState(false);
  const involved = groups.filter((group) =>
    selected.some((entry) => group.tasks.some((candidate) => candidate.key === entry.key)),
  );
  const machines = [
    ...new Set(reachableProjects(involved).map((project) => project.environmentId)),
  ].toSorted((left, right) => labelOf(left).localeCompare(labelOf(right)));
  const allowed = useAtomValue(
    projectEnvironment.tasks.prepareBatch.permissionAtom(
      selected[0]?.home.environmentId ?? machines[0] ?? ("" as EnvironmentId),
    ),
  );
  const distributionLabel = (value: string) =>
    value === "spread"
      ? "Spread across machines"
      : value === "saved"
        ? "Each task's machine"
        : `On ${labelOf(value as EnvironmentId)}`;
  const review = async () => {
    setPreparing(true);
    const prepared = await run.prepare(selected, distribution, concurrency);
    setPreparing(false);
    if ("error" in prepared) {
      toastManager.add({
        type: "error",
        title: "Could not plan the run",
        description: prepared.error,
      });
      return;
    }
    setPlan(prepared);
  };
  const confirm = async () => {
    if (!plan) return;
    setStarting(true);
    const error = await run.start(plan.groups);
    setStarting(false);
    if (error) {
      toastManager.add({ type: "error", title: "Could not start the batch", description: error });
      return;
    }
    toastManager.add({
      type: "success",
      title: `Queued ${plan.summary.runnable} ${plan.summary.runnable === 1 ? "task" : "tasks"}`,
    });
    setPlan(null);
    onClear();
  };
  const count = selected.length;
  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="flex h-11 shrink-0 items-center gap-2 border-t border-border bg-background px-3"
    >
      <Button size="icon-xs" variant="ghost-muted" aria-label="Clear selection" onClick={onClear}>
        <XIcon />
      </Button>
      <span className="shrink-0 text-sm tabular-nums">{count} selected</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <div className="w-48 min-w-0 shrink">
          <Select value={distribution} onValueChange={(value) => value && setDistribution(value)}>
            <SelectTrigger size="compact" aria-label="Where to run">
              <SelectValue>{(value: string) => distributionLabel(value)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="saved">{distributionLabel("saved")}</SelectItem>
              {machines.length > 1 ? (
                <SelectItem value="spread">{distributionLabel("spread")}</SelectItem>
              ) : null}
              {machines.map((environmentId) => (
                <SelectItem key={environmentId} value={environmentId}>
                  {distributionLabel(environmentId)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="w-36 shrink-0">
          <Select
            value={String(concurrency)}
            onValueChange={(value) => value && setConcurrency(Number(value))}
          >
            <SelectTrigger size="compact" aria-label="How many run at once">
              <SelectValue>{(value: string) => `Max ${value} at a time`}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {Array.from({ length: TASK_BATCH_MAX_CONCURRENCY }, (_, index) => index + 1).map(
                (value) => (
                  <SelectItem key={value} value={String(value)}>
                    Max {value} at a time
                  </SelectItem>
                ),
              )}
            </SelectPopup>
          </Select>
        </div>
        <Button
          size="compact"
          disabled={!allowed || preparing || count === 0}
          onClick={() => void review()}
        >
          {preparing ? "Planning…" : `Run ${count}`}
        </Button>
      </div>
      <TaskBatchConfirm
        plan={plan}
        starting={starting}
        onConfirm={() => void confirm()}
        onClose={() => setPlan(null)}
      />
    </div>
  );
}

/**
 * Retry for a task the machine did not start. A failed start was already confirmed, so it
 * starts again; a refusal means something changed, so it is prepared and confirmed again.
 * Both keep the machine's current limit.
 */
function useTaskRetry(group: TaskProjectGroup) {
  const run = useTaskBatchRun([group]);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<TaskBatchPlan | null>(null);
  const [starting, setStarting] = useState(false);
  const fail = (description: string) =>
    toastManager.add({ type: "error", title: "Could not retry", description });
  return {
    busy,
    retry: async (entry: TaskEntry, queue: TaskQueueView) => {
      setBusy(true);
      const prepared = await run.prepare([entry], queue.target.environmentId, queue.cap);
      if ("error" in prepared) {
        setBusy(false);
        fail(prepared.error);
        return;
      }
      if (queue.state === "refused") {
        setBusy(false);
        setPlan(prepared);
        return;
      }
      const error = await run.start(prepared.groups);
      setBusy(false);
      if (error) fail(error);
    },
    dialog: (
      <TaskBatchConfirm
        plan={plan}
        starting={starting}
        onClose={() => setPlan(null)}
        onConfirm={() => {
          if (!plan) return;
          setStarting(true);
          void run.start(plan.groups).then((error) => {
            setStarting(false);
            if (error) fail(error);
            else setPlan(null);
          });
        }}
      />
    ),
  };
}

/** The live queue across loaded machines, each machine's limit, and what did not start. */
export function TaskQueueBar({ groups }: { groups: ReadonlyArray<TaskProjectGroup> }) {
  const labelOf = useEnvironmentLabel();
  const projects = reachableProjects(groups);
  const totals = taskQueueTotals(
    projects,
    groups.flatMap((group) => group.tasks),
  );
  const cancel = useAtomCommand(projectEnvironment.tasks.batchCancel);
  const [busy, setBusy] = useState(false);
  const active = totals.queued + totals.starting + totals.running + totals.failed;
  if (active + totals.refused.length === 0) return null;
  const parts = [
    totals.running + totals.starting > 0 ? `${totals.running + totals.starting} running` : null,
    totals.queued > 0 ? `${totals.queued} queued` : null,
    totals.failed > 0 ? `${totals.failed} failed to start` : null,
  ].filter(Boolean);
  const caps =
    totals.caps.length === 1
      ? `Max ${totals.caps[0]!.cap} at a time`
      : totals.caps
          .map(({ environmentId, cap }) => `Max ${cap} on ${labelOf(environmentId)}`)
          .join(" · ");
  return (
    <div
      role="status"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground"
    >
      <ListOrderedIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate tabular-nums">
        {["Queue", ...parts, caps].filter(Boolean).join(" · ")}
      </span>
      {totals.refused.length > 0 ? (
        <Popover>
          <PopoverTrigger render={<Button size="micro" variant="ghost" />}>
            {totals.refused.length} not started
          </PopoverTrigger>
          <PopoverPopup align="start" padding="compact" width="lg">
            <ul className="flex flex-col">
              {totals.refused.map(({ entry, queue }) => {
                const group = groups.find((candidate) =>
                  candidate.tasks.some((task) => task.key === entry.key),
                )!;
                return <RefusedRow key={entry.key} entry={entry} group={group} queue={queue} />;
              })}
            </ul>
          </PopoverPopup>
        </Popover>
      ) : null}
      {totals.cancellable.length > 0 ? (
        <Button
          size="micro"
          variant="ghost"
          disabled={busy}
          className="ml-auto"
          onClick={async () => {
            setBusy(true);
            await Promise.all(
              totals.cancellable.map((batch) =>
                cancel({
                  environmentId: batch.environmentId,
                  input: {
                    commandId: CommandId.make(randomUUID()),
                    projectId: batch.projectId as never,
                    batchId: batch.batchId as never,
                  },
                }),
              ),
            );
            setBusy(false);
          }}
        >
          Cancel remaining
        </Button>
      ) : null}
    </div>
  );
}

function RefusedRow({
  entry,
  group,
  queue,
}: {
  entry: TaskEntry;
  group: TaskProjectGroup;
  queue: TaskQueueView;
}) {
  const retry = useTaskRetry(group);
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-1.5">
      <div className="flex h-7 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{taskTitle(entry.task)}</span>
        <Button
          size="micro"
          variant="ghost"
          disabled={retry.busy}
          onClick={() => void retry.retry(entry, queue)}
        >
          Retry
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{queue.reason}</p>
      {retry.dialog}
    </li>
  );
}

/** Queue positions count per destination machine, across all its projects. */
export function useTaskQueue(entry: TaskEntry): TaskQueueView | null {
  return taskQueueView(taskQueueItems(entry, useProjects()), entry.status);
}

/** A row's queue state: position, starting, or why it did not start with Retry. */
export function TaskQueueChip({
  entry,
  group,
  queue,
}: {
  entry: TaskEntry;
  group: TaskProjectGroup;
  queue: TaskQueueView;
}) {
  const retry = useTaskRetry(group);
  if (queue.state === "running") return null;
  if (queue.state === "failed-to-start" || queue.state === "refused") {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={<Badge variant={queue.state === "refused" ? "warning" : "error"} size="sm" />}
          >
            {queue.state === "refused" ? "Not started" : "Failed to start"}
          </TooltipTrigger>
          <TooltipPopup className="max-w-72">
            {queue.reason ?? "The machine refused the start."}
          </TooltipPopup>
        </Tooltip>
        <Button
          size="micro"
          variant="ghost"
          disabled={retry.busy}
          onClick={() => void retry.retry(entry, queue)}
        >
          Retry
        </Button>
        {retry.dialog}
      </span>
    );
  }
  return (
    <Badge variant="quiet" size="sm">
      {queue.state === "queued"
        ? `Queued${queue.position ? ` · #${queue.position}` : ""}`
        : "Starting"}
    </Badge>
  );
}

/**
 * A batch that ran tasks from another machine settles there; this links each thread and its
 * result back to the task's machine once the destination's batch is loaded.
 */
export function TaskBatchReconcilers({ groups }: { groups: ReadonlyArray<TaskProjectGroup> }) {
  return reachableProjects(groups).flatMap((project) =>
    (project.taskBatches ?? [])
      .filter((batch) =>
        batch.entries.some(
          (item) =>
            item.source.environmentId !== project.environmentId &&
            (item.state === "running" || item.state === "settled"),
        ),
      )
      .map((batch) => (
        <ReconcileBatch
          key={`${project.environmentId}:${batch.id}`}
          project={project}
          batchId={batch.id}
          signature={batch.entries.map((item) => `${item.id}:${item.state}`).join(",")}
        />
      )),
  );
}

function ReconcileBatch({
  project,
  batchId,
  signature,
}: {
  project: EnvironmentProject;
  batchId: string;
  signature: string;
}) {
  const reconcile = useAtomCommand(projectEnvironment.tasks.reconcileBatch, {
    reportFailure: false,
  });
  const sent = useRef<string | null>(null);
  const environmentId = project.environmentId;
  const projectId = project.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- links a destination batch's threads back to their tasks' machines when its entries change; the server dedupes by command id
  useEffect(() => {
    if (sent.current === signature) return;
    sent.current = signature;
    void reconcile({
      target: scopeProjectRef(environmentId, projectId),
      batchId: batchId as never,
    });
  }, [reconcile, environmentId, projectId, batchId, signature]);
  return null;
}
