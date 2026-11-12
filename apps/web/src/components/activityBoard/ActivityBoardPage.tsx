import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { SidebarColorMarker } from "../sidebar/SidebarColorPicker";
import { KeepAwakeControl } from "../KeepAwakeControl";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { FolderGit2Icon, FolderIcon, GitBranchIcon } from "lucide-react";
import { useContext, useEffect } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import {
  useEnvironmentConnectionSummaries,
  useEnvironmentMachines,
} from "../../state/environments";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ConnectionStatusDot, connectionPhaseDotClassName } from "../ConnectionStatusDot";
import { ENVIRONMENT_MACHINE_KIND_LABELS, EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { sidebarProviderEntriesAtom } from "../sidebar/sidebarProviderEntries";
import type { SidebarProviderEntry } from "../sidebar/SidebarThreadRow";
import { MachineMeter } from "../systemMonitor/MachineMeter";
import { Badge } from "../ui/badge";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildActivityBoard,
  presentHostCapacity,
  type ActivityBoardColumn,
  type ActivityBoardThread,
  type HostCapacity,
  type ThreadActivityState,
} from "./activityBoard.logic";

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
// Matches the freshness window load balancing reads the same sample with.
const HOST_RESOURCES_REFRESH_MS = 15_000;

const STATE_TONE: Record<ThreadActivityState, string> = {
  approval: "text-amber-600 dark:text-amber-300/90",
  input: "text-indigo-600 dark:text-indigo-300/90",
  request: "text-guest-foreground",
  working: "text-sky-600 dark:text-sky-300/80",
  starting: "text-sky-600 dark:text-sky-300/80",
  waiting: "text-muted-foreground",
  subagents: "text-muted-foreground",
  background: "text-muted-foreground",
};

export function ActivityBoardPage() {
  const environments = useEnvironmentConnectionSummaries();
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const sidebarProjects = useSidebarProjectGroups();
  const projectColors = new Map(
    sidebarProjects.flatMap((group) =>
      group.memberProjectRefs.map(
        (ref) => [`${ref.environmentId}:${ref.projectId}`, group.sidebarColor] as const,
      ),
    ),
  );
  const columns = buildActivityBoard({ environments, threads, projects });
  const total = columns.reduce((count, column) => count + column.cardCount, 0);
  const connected = columns.filter((column) => column.connected).length;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Activity</h1>
          <span className="truncate text-xs text-muted-foreground">
            {total === 0 ? "Nothing running" : `${total} active`} · {connected} of {columns.length}{" "}
            {columns.length === 1 ? "node" : "nodes"} connected
          </span>
        </WorkspacePageHeader>
        {columns.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No environments are set up yet.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:flex-row md:overflow-x-auto md:overflow-y-hidden">
            {columns.map((column) => (
              <ActivityColumn
                key={column.environment.environmentId}
                column={column}
                projectColors={projectColors}
              />
            ))}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

function ActivityColumn({
  column,
  projectColors,
}: {
  column: ActivityBoardColumn;
  projectColors: ReadonlyMap<string, string | null | undefined>;
}) {
  const { environment } = column;
  const machine = useEnvironmentMachines().get(environment.environmentId) ?? "server";
  const providerEntries =
    useAtomValue(sidebarProviderEntriesAtom).get(environment.environmentId) ??
    EMPTY_PROVIDER_ENTRIES;
  const statusTitle = connectionStatusTitle({
    phase: environment.connectionState,
    error: environment.connectionError,
    traceId: environment.connectionErrorTraceId,
  });

  return (
    <section
      aria-label={environment.environmentLabel}
      className="flex shrink-0 flex-col rounded-lg border border-border bg-card md:min-h-0 md:w-80"
    >
      <header className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <ConnectionStatusDot
            tooltipText={statusTitle}
            dotClassName={connectionPhaseDotClassName(environment.connectionState)}
          />
          <EnvironmentMachineIcon
            kind={machine}
            aria-label={ENVIRONMENT_MACHINE_KIND_LABELS[machine]}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {environment.environmentLabel}
          </h2>
          {column.connected ? <KeepAwakeControl environmentId={environment.environmentId} /> : null}
          {column.connected ? (
            <Badge variant={column.cardCount > 0 ? "info" : "secondary"} size="sm">
              {column.cardCount}
            </Badge>
          ) : null}
        </div>
        {column.connected ? (
          <NodeCapacity environmentId={environment.environmentId} />
        ) : (
          <p className="text-xs text-muted-foreground">{statusTitle}</p>
        )}
      </header>
      <div className="flex flex-col gap-4 p-3 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {!column.connected ? (
          <p className="text-sm text-muted-foreground">
            Not connected, so its activity is unknown.
          </p>
        ) : column.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is running here.</p>
        ) : (
          column.groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {group.project ? (
                  <ProjectFavicon project={group.project} className="size-3.5 shrink-0" />
                ) : (
                  <FolderIcon className="size-3.5 shrink-0" />
                )}
                <SidebarColorMarker
                  color={
                    group.project
                      ? projectColors.get(`${group.project.environmentId}:${group.project.id}`)
                      : null
                  }
                />
                <span className="truncate">{group.project?.title ?? "Unknown project"}</span>
              </h3>
              {group.cards.map((card) => (
                <div
                  key={card.thread.id}
                  className="relative flex flex-col gap-2 rounded-lg border border-border bg-background p-3 hover:bg-accent/40 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring"
                >
                  <ThreadLink
                    entry={card}
                    className="truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-['']"
                  />
                  <ActivityMeta entry={card} providerEntries={providerEntries} />
                  {card.thread.branch || card.thread.worktreePath ? (
                    <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                      {card.thread.branch ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <GitBranchIcon className="size-3 shrink-0" />
                          <span className="truncate">{card.thread.branch}</span>
                        </span>
                      ) : null}
                      {card.thread.worktreePath ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="relative z-10 flex min-w-0 items-center gap-1" />
                            }
                          >
                            <FolderGit2Icon className="size-3 shrink-0" />
                            <span className="truncate">
                              {formatWorktreePathForDisplay(card.thread.worktreePath)}
                            </span>
                          </TooltipTrigger>
                          <TooltipPopup side="bottom">{card.thread.worktreePath}</TooltipPopup>
                        </Tooltip>
                      ) : null}
                    </div>
                  ) : null}
                  {card.subagents.length > 0 ? (
                    <ul className="flex flex-col gap-1 border-l border-border pl-2">
                      {card.subagents.map((subagent) => (
                        <li key={subagent.thread.id} className="flex flex-col">
                          <ThreadLink
                            entry={subagent}
                            className="relative z-10 truncate text-xs hover:underline"
                          />
                          <ActivityMeta entry={subagent} providerEntries={providerEntries} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ThreadLink({ entry, className }: { entry: ActivityBoardThread; className: string }) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(scopeThreadRef(entry.thread.environmentId, entry.thread.id))}
      className={className}
    >
      {entry.thread.title || "Untitled thread"}
    </Link>
  );
}

function ActivityMeta({
  entry,
  providerEntries,
}: {
  entry: ActivityBoardThread;
  providerEntries: ReadonlyMap<string, SidebarProviderEntry>;
}) {
  const { modelSelection } = entry.thread;
  const provider = providerEntries.get(modelSelection.instanceId) ?? null;
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection.model);
  const modelLabel = model
    ? getTriggerDisplayModelName(model, provider?.driverKind)
    : modelSelection.model;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className={cn("shrink-0 font-medium", STATE_TONE[entry.state])}>{entry.label}</span>
      {entry.since === null ? null : (
        <span className="shrink-0 text-muted-foreground tabular-nums">
          <SinceLabel since={entry.since} />
        </span>
      )}
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        {provider ? (
          <ProviderInstanceIcon
            driverKind={provider.driverKind}
            displayName={provider.displayName}
            accentColor={provider.accentColor}
            acpRegistryAgentId={provider.acpRegistryAgentId}
            acpRegistryIconUrl={provider.acpRegistryIconUrl}
            size="compact"
          />
        ) : null}
        <span className="truncate">
          {provider ? `${provider.displayName} · ${modelLabel}` : modelLabel}
        </span>
      </span>
    </div>
  );
}

// Subscribes to the minute tick itself, so only the label re-renders.
function SinceLabel({ since }: { since: string }) {
  const nowMinute = useNowMinute();
  const elapsedMs = Date.parse(`${nowMinute}:00.000Z`) - Date.parse(since);
  if (!Number.isFinite(elapsedMs)) return null;
  return elapsedMs < 60_000 ? "<1m" : formatWorkingDurationLabel(elapsedMs);
}

function NodeCapacity({ environmentId }: { environmentId: EnvironmentId }) {
  const registry = useContext(RegistryContext);
  const atom = serverEnvironment.hostResources({ environmentId, input: {} });
  const query = useEnvironmentQuery(atom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the host's resource sample only while the board is open and visible
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
      }
    }, HOST_RESOURCES_REFRESH_MS);
    return () => clearInterval(timer);
  }, [registry, environmentId]);

  const capacity = query.data === null ? null : presentHostCapacity(query.data);
  if (capacity === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {query.error === null ? "Reading capacity…" : "Capacity unavailable on this node."}
      </p>
    );
  }
  return <CapacityMeters capacity={capacity} />;
}

function CapacityMeters({ capacity }: { capacity: HostCapacity }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {capacity.cpuCount} {capacity.cpuCount === 1 ? "core" : "cores"}
        </span>
        {capacity.level === "ok" ? null : (
          <Tooltip>
            <TooltipTrigger
              render={<Badge variant={capacity.level === "busy" ? "warning" : "error"} size="sm" />}
            >
              {capacity.level === "busy" ? "Busy" : "Strained"}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {capacity.level === "busy"
                ? "CPU or memory is running high."
                : "Automatic machine selection skips this node until it frees up."}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
      <MachineMeter
        label="CPU"
        share={capacity.cpu}
        detail={capacity.cpu === null ? "unknown" : `${Math.round(capacity.cpu * 100)}%`}
        level={capacity.level}
      />
      <MachineMeter
        label="Memory"
        share={capacity.memoryUsed}
        detail={`${formatBytes(capacity.usedMemoryBytes)} / ${formatBytes(capacity.totalMemoryBytes)}`}
        level={capacity.level}
      />
    </div>
  );
}
