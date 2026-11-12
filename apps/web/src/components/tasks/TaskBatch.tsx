import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommandId, type EnvironmentId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { ListOrderedIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { randomUUID } from "../../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  TASK_BATCH_DEFAULT_CONCURRENCY,
  TASK_BATCH_MAX_CONCURRENCY,
  taskBatchSummary,
  taskQueueItems,
  taskQueueTotals,
  taskQueueView,
  taskRunProject,
  type TaskBatchPlanGroup,
  type TaskBatchSummaryRow,
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

/** Prepares a batch (where each task runs) and starts the prepared groups. */
function useTaskBatchRun(groups: ReadonlyArray<TaskProjectGroup>) {
  const prepare = useAtomCommand(projectEnvironment.tasks.prepareBatch, { reportFailure: false });
  const start = useAtomCommand(projectEnvironment.tasks.batchStart, { reportFailure: false });
  const groupOf = (entry: TaskEntry) =>
    groups.find((group) => group.tasks.some((candidate) => candidate.key === entry.key))!;
  return {
    prepare: async (
      entries: ReadonlyArray<TaskEntry>,
      distribution: Distribution,
      concurrency: number,
    ): Promise<{ groups: TaskBatchPlanGroup[] } | { error: string }> => {
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
      return result._tag === "Success"
        ? { groups: result.value as unknown as TaskBatchPlanGroup[] }
        : { error: failureMessage(result) };
    },
    start: async (plan: ReadonlyArray<TaskBatchPlanGroup>) => {
      const results = await Promise.all(
        plan.map((group) =>
          start({ environmentId: group.environmentId, input: group.input as never }),
        ),
      );
      const failed = results.filter((result) => result._tag !== "Success");
      return failed.length === 0 ? null : failureMessage(failed[0] as never);
    },
  };
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
  const [plan, setPlan] = useState<{
    groups: TaskBatchPlanGroup[];
    rows: TaskBatchSummaryRow[];
  } | null>(null);
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
    setPlan({
      groups: prepared.groups,
      rows: taskBatchSummary(
        prepared.groups,
        selected,
        {
          distribute: distribution === "spread",
          environmentId:
            distribution === "spread" || distribution === "saved"
              ? null
              : (distribution as EnvironmentId),
        },
        labelOf,
      ),
    });
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
      title: `Queued ${selected.length} ${selected.length === 1 ? "task" : "tasks"}`,
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
      <AlertDialog open={plan !== null} onOpenChange={(open) => !open && setPlan(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Run {count} {count === 1 ? "task" : "tasks"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each starts a paid agent turn with no one watching. At most {concurrency} run at once
              on each machine; the rest wait in a queue you can cancel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto px-6 pb-2">
            {plan?.rows.map((row) => (
              <section key={row.environmentId} aria-label={row.machine} className="flex flex-col">
                <h3 className="flex h-7 items-center gap-1 text-xs font-medium text-muted-foreground">
                  <span className="truncate">{row.machine}</span>
                  <span className="tabular-nums">· {row.tasks.length}</span>
                </h3>
                <ul className="flex flex-col">
                  {row.tasks.map((item) => (
                    <li key={item.key} className="flex h-7 min-w-0 items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.pinned ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={<span className="shrink-0 text-xs text-muted-foreground" />}
                          >
                            Pinned to its machine
                          </TooltipTrigger>
                          <TooltipPopup>{item.pinned}</TooltipPopup>
                        </Tooltip>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button disabled={starting} onClick={() => void confirm()}>
              {starting ? "Starting…" : `Start ${count}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

/** The live queue across loaded machines, with one way to stop what has not started. */
export function TaskQueueBar({ groups }: { groups: ReadonlyArray<TaskProjectGroup> }) {
  const projects = reachableProjects(groups);
  const totals = taskQueueTotals(projects);
  const cancel = useAtomCommand(projectEnvironment.tasks.batchCancel);
  const [busy, setBusy] = useState(false);
  if (totals.queued + totals.starting + totals.running + totals.failed === 0) return null;
  const parts = [
    totals.running + totals.starting > 0 ? `${totals.running + totals.starting} running` : null,
    totals.queued > 0 ? `${totals.queued} queued` : null,
    totals.failed > 0 ? `${totals.failed} failed to start` : null,
  ].filter(Boolean);
  return (
    <div
      role="status"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground"
    >
      <ListOrderedIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate tabular-nums">Queue · {parts.join(" · ")}</span>
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

/** Queue positions count per destination machine, across all its projects. */
export function useTaskQueue(entry: TaskEntry): TaskQueueView | null {
  return taskQueueView(taskQueueItems(entry, useProjects()));
}

/** A row's queue state: position, starting, or why it failed to start with Retry. */
export function TaskQueueChip({
  entry,
  group,
  queue,
}: {
  entry: TaskEntry;
  group: TaskProjectGroup;
  queue: TaskQueueView;
}) {
  const run = useTaskBatchRun([group]);
  const [busy, setBusy] = useState(false);
  if (queue.state === "running") return null;
  if (queue.state === "failed-to-start") {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger render={<Badge variant="error" size="sm" />}>
            Failed to start
          </TooltipTrigger>
          <TooltipPopup className="max-w-72">
            {queue.reason ?? "The machine refused the start."}
          </TooltipPopup>
        </Tooltip>
        <Button
          size="micro"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const prepared = await run.prepare([entry], queue.target.environmentId, 1);
            const error = "error" in prepared ? prepared.error : await run.start(prepared.groups);
            setBusy(false);
            if (error)
              toastManager.add({ type: "error", title: "Could not retry", description: error });
          }}
        >
          Retry
        </Button>
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
