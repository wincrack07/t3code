import { useAtomValue } from "@effect/atom-react";
import {
  pickableProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useClientSettings } from "../hooks/useSettings";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects, useThreadShell, useVisibleThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerKeybindingsAtom } from "../state/server";
import { buildThreadMoveTargetSections } from "../threadProjectMove.logic";
import { moveThreadToProject, watchThreadProjectMoves } from "../threadProjectMove";
import {
  filterCommandPaletteGroups,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { ProjectFavicon } from "./ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "./Sidebar.logic";
import { Badge } from "./ui/badge";
import { CommandDialog, CommandDialogPopup } from "./ui/command";

const useMoveRequest = create<{ threadRef: ScopedThreadRef | null }>(() => ({ threadRef: null }));

/** Opens the project picker for one thread; every thread menu and the palette land here. */
export function openMoveThreadToProject(threadRef: ScopedThreadRef) {
  useMoveRequest.setState({ threadRef });
}

function close() {
  useMoveRequest.setState({ threadRef: null });
}

export function MoveThreadToProjectDialogHost() {
  const threadRef = useMoveRequest((state) => state.threadRef);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops a request left open when the host unmounts
  useEffect(() => () => close(), []);
  return (
    <CommandDialog open={threadRef !== null} onOpenChange={(open) => !open && close()}>
      {threadRef ? <MoveThreadToProjectPicker threadRef={threadRef} /> : null}
    </CommandDialog>
  );
}

/** Announces moves that apply later or come from another client. */
export function ThreadProjectMoveToasts() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the shell store to toast moves this client did not make
  useEffect(() => watchThreadProjectMoves(), []);
  return null;
}

function MoveThreadToProjectPicker({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const sortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  if (thread === null) return null;

  const labelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const machineLabel = labelById.get(threadRef.environmentId) ?? "this machine";
  // Pinned projects lead, then the sidebar's own order.
  const groups = pickableProjectGroups(
    sortLogicalProjectsForSidebar(
      buildSidebarProjectSnapshots({
        projects,
        settings: groupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => labelById.get(environmentId) ?? null,
      }),
      threads,
      sortOrder,
    ),
  );
  const sections = buildThreadMoveTargetSections({
    groups,
    folders,
    thread,
    machineLabel,
  });
  const pendingProjectId = thread.pendingProjectMove?.projectId ?? null;
  const paletteGroups: CommandPaletteGroup[] = sections.map((section) => ({
    value: `move-section:${section.id}`,
    label: section.label,
    items: section.targets.map((target): CommandPaletteActionItem => ({
      kind: "action",
      value: `move-target:${target.group.projectKey}`,
      searchTerms: [target.group.displayName],
      title: target.group.displayName,
      icon: <ProjectFavicon project={target.group} className={ITEM_ICON_CLASS} />,
      ...(target.disabledReason === null
        ? {}
        : { disabled: true, description: target.disabledReason }),
      ...(target.project !== null && target.project.id === pendingProjectId
        ? {
            titleTrailingContent: (
              <Badge variant="secondary" size="sm">
                Pending
              </Badge>
            ),
          }
        : {}),
      run: async () => {
        if (target.project === null) return;
        void moveThreadToProject(threadRef, target.project.id);
      },
    })),
  }));
  const visibleGroups = filterCommandPaletteGroups({
    activeGroups: paletteGroups,
    query,
    isInSubmenu: true,
    projectSearchItems: [],
    threadSearchItems: [],
  });

  return (
    <CommandDialogPopup
      aria-label="Move thread to project"
      className="overflow-hidden"
      onBackdropPointerDown={close}
    >
      <CommandPaletteContent
        aria-label="Move thread to project"
        autoHighlight="always"
        footerActionLabel="Move"
        inputProps={{ placeholder: `Move "${thread.title}" to…` }}
        mode="none"
        onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
        onValueChange={(value) => {
          setHighlighted(null);
          setQuery(value);
        }}
        testId="move-thread-to-project"
        value={query}
      >
        <CommandPaletteResults
          emptyStateMessage="No matching projects."
          groups={visibleGroups}
          highlightedItemValue={highlighted}
          isActionsOnly={false}
          keybindings={keybindings}
          onExecuteItem={(item) => {
            if (item.kind !== "action" || item.disabled) return;
            close();
            void item.run();
          }}
        />
      </CommandPaletteContent>
    </CommandDialogPopup>
  );
}
