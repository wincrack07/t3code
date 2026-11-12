import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useContext, useEffect, useState } from "react";

import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import {
  applyProjectGroupProposal,
  countProjectGroupProposal,
  projectFolderPath,
  type ProjectGroupProposalRow,
} from "../../projectFolders";
import {
  buildProjectGroupProposal,
  projectGroupSuggestionInput,
  ungroupedProjectCandidates,
  type ProjectGroupProposal,
  type ProjectGroupProposalSource,
} from "../../projectGroupProposal";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function actionLabel({ groups, projects }: { groups: number; projects: number }) {
  const move = `move ${plural(projects, "project")}`;
  if (groups === 0) return move.charAt(0).toUpperCase() + move.slice(1);
  return projects === 0
    ? `Create ${plural(groups, "group")}`
    : `Create ${plural(groups, "group")}, ${move}`;
}

function sourceLabel(source: ProjectGroupProposalSource) {
  if (source.kind === "model") return `Suggested by ${source.model}`;
  const why = {
    failed: "the model was unavailable",
    timeout: "the model took too long",
    "invalid-output": "the model's answer was unreadable",
    "no-environment": "no connected environment can run a model",
  }[source.reason];
  return `Suggested from shared name prefixes, as ${why}`;
}

/**
 * The model runs on the primary environment, which also holds the group settings; when it
 * cannot run one, the first environment of the listed projects that can. Project keys are
 * opaque to it, so projects from other environments come back unchanged.
 */
function pickSuggestionEnvironment(
  candidates: readonly (EnvironmentId | null)[],
  canRun: (environmentId: EnvironmentId) => boolean,
): EnvironmentId | null {
  return candidates.find((id): id is EnvironmentId => id !== null && canRun(id)) ?? null;
}

export function ProjectGroupSuggestions({
  projects,
  onClose,
}: {
  projects: readonly SidebarProjectSnapshot[];
  onClose: () => void;
}) {
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const update = useUpdatePrimarySettings();
  const registry = useContext(RegistryContext);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const suggest = useAtomCommand(serverEnvironment.suggestProjectGroups, { reportFailure: false });
  const candidates = ungroupedProjectCandidates(projects, folders);
  // Each attempt keeps what it asked about, so sidebar changes while the model runs do not ask again.
  const [request, setRequest] = useState(() => ({ candidates, folders }));
  const [proposal, setProposal] = useState<ProjectGroupProposal | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the environment's model when the dialog opens and on Try again
  useEffect(() => {
    const { candidates, folders } = request;
    if (candidates.length === 0) return;
    let current = true;
    const environmentId = pickSuggestionEnvironment(
      [
        primaryEnvironmentId,
        ...candidates.flatMap((project) =>
          project.memberProjects.map((member) => member.environmentId),
        ),
      ],
      (id) => registry.get(serverEnvironment.suggestProjectGroups.permissionAtom(id)),
    );
    const asking = environmentId
      ? suggest({ environmentId, input: projectGroupSuggestionInput(candidates, folders) })
      : Promise.resolve(null);
    void asking.then((result) => {
      if (!current) return;
      const value = result?._tag === "Success" ? result.value : result === null ? null : undefined;
      setProposal(
        buildProjectGroupProposal(
          value === undefined ? { _tag: "Unavailable", reason: "failed" } : value,
          candidates,
          folders,
        ),
      );
    });
    return () => {
      current = false;
    };
  }, [request, primaryEnvironmentId, registry, suggest]);

  const retry = () => {
    setProposal(null);
    setRequest({ candidates, folders });
  };
  const setRows = (change: (rows: ProjectGroupProposalRow[]) => ProjectGroupProposalRow[]) =>
    setProposal((current) => (current ? { ...current, rows: change(current.rows) } : current));
  const editRow = (id: string, change: (row: ProjectGroupProposalRow) => ProjectGroupProposalRow) =>
    setRows((rows) => rows.map((row) => (row.id === id ? change(row) : row)));

  const rows = proposal?.rows ?? [];
  const counts = countProjectGroupProposal(rows);
  const asked = request.candidates.length;
  const loading = asked > 0 && proposal === null;
  const empty = !loading && rows.length === 0;
  const parentLabel = (row: ProjectGroupProposalRow) => {
    if (row.parentRef !== undefined) return rows.find((entry) => entry.id === row.parentRef)?.name;
    if (
      row.parentGroupId !== undefined &&
      folders.some((folder) => folder.id === row.parentGroupId)
    )
      return projectFolderPath(folders, row.parentGroupId);
    return undefined;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Suggested project groups</DialogTitle>
          <DialogDescription>
            Review before applying. Unchecked projects stay ungrouped.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {asked === 0 ? (
            <p className="text-sm text-muted-foreground">Every project is already in a group.</p>
          ) : loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" tone="muted" />
              Asking the model about {plural(asked, "ungrouped project")}…
            </p>
          ) : empty ? (
            <p className="text-sm text-muted-foreground">
              No grouping found for {plural(asked, "ungrouped project")}. Titles and repositories
              gave no clear way to group them.
            </p>
          ) : (
            <ul aria-label="Proposed groups" className="-mx-2 space-y-2">
              {rows.map((row) => {
                const checkedCount = row.projects.filter((project) => project.checked).length;
                const parent = parentLabel(row);
                return (
                  <li key={row.id}>
                    <div className="flex h-8 items-center gap-2 rounded-lg px-2 hover:bg-accent/50">
                      <Checkbox
                        aria-label={`Include ${row.name || "group"}`}
                        checked={row.checked}
                        indeterminate={
                          row.checked && checkedCount > 0 && checkedCount < row.projects.length
                        }
                        onCheckedChange={(checked) =>
                          editRow(row.id, (entry) => ({
                            ...entry,
                            checked,
                            projects: entry.projects.map((project) => ({ ...project, checked })),
                          }))
                        }
                      />
                      {row.kind === "new" ? (
                        <div className="min-w-0 flex-1">
                          <Input
                            size="compact"
                            aria-label="Group name"
                            value={row.name}
                            onChange={(event) =>
                              editRow(row.id, (entry) => ({ ...entry, name: event.target.value }))
                            }
                          />
                        </div>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {row.name}
                        </span>
                      )}
                      {parent ? (
                        <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
                          in {parent}
                        </span>
                      ) : null}
                      {row.kind === "existing" ? (
                        <Badge variant="outline" size="sm">
                          Existing
                        </Badge>
                      ) : null}
                    </div>
                    <ul className="ms-6">
                      {row.projects.map((project) => (
                        <li key={project.key}>
                          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent/50">
                            <Checkbox
                              checked={project.checked}
                              onCheckedChange={(checked) =>
                                editRow(row.id, (entry) => ({
                                  ...entry,
                                  checked: entry.checked || checked,
                                  projects: entry.projects.map((candidate) =>
                                    candidate.key === project.key
                                      ? { ...candidate, checked }
                                      : candidate,
                                  ),
                                }))
                              }
                            />
                            <span className="min-w-0 truncate">{project.title}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
          {proposal ? (
            <div className="flex min-h-7 items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">
                {sourceLabel(proposal.source)}
                {proposal.omitted > 0
                  ? `. ${plural(proposal.omitted, "more project")} left out of this request.`
                  : ""}
              </span>
              <Button size="xs" variant="ghost" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            {empty ? "Close" : "Cancel"}
          </Button>
          {!loading && !empty ? (
            <Button
              size="sm"
              disabled={counts.groups + counts.projects === 0}
              onClick={() => {
                update({
                  sidebarThreadGrouping: "project",
                  sidebarProjectFolders: applyProjectGroupProposal(folders, rows, randomUUID),
                });
                onClose();
              }}
            >
              {counts.groups + counts.projects === 0 ? "Nothing selected" : actionLabel(counts)}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
