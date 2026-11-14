import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { T3ThreadExport } from "@t3tools/contracts";
import { getCloneDestinationPath } from "@t3tools/client-runtime/operations/projects";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "../ui/wizard";
import { WorkspaceFolderPicker } from "../WorkspaceFolderPicker";
import {
  chatIncluded,
  foldersReady,
  IMPORT_STEPS,
  NEW_PROJECT,
  projectQueryMatches,
  projectSelection,
  remainingChats,
  setAllProjects,
  toggleChat,
  toggleProject,
  type ImportChatRef,
  type ImportDraft,
  type ImportSession,
} from "./ChatImportSettings.logic";

interface ImportGroup {
  readonly key: string;
  readonly count: number;
  readonly folderName: string;
  readonly source: T3ThreadExport["project"];
  readonly project: { readonly id: string; readonly title: string } | null;
}

export function ChatImportWizard({
  session,
  groups,
  chats,
  candidates,
  canCreate,
  canMove,
  allowed,
  onDraft,
  onClose,
  onImport,
  onStop,
}: {
  readonly session: ImportSession;
  readonly groups: readonly ImportGroup[];
  readonly chats: readonly ImportChatRef[];
  readonly candidates: readonly { readonly id: string; readonly title: string }[];
  readonly canCreate: boolean;
  readonly canMove: boolean;
  readonly allowed: boolean;
  readonly onDraft: (draft: ImportDraft) => void;
  readonly onClose: () => void;
  readonly onImport: () => void;
  readonly onStop: () => void;
}) {
  const { draft, busy } = session;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const knownProjectIds = new Set(candidates.map((project) => project.id));
  const byProject = new Map<string, ImportChatRef[]>();
  for (const chat of chats) {
    const list = byProject.get(chat.projectKey);
    if (list) list.push(chat);
    else byProject.set(chat.projectKey, [chat]);
  }
  const remaining = remainingChats(chats, draft);
  const remainingKeys = new Set(remaining.map((chat) => chat.projectKey));
  const createsProjects = groups.some(
    (group) => remainingKeys.has(group.key) && draft.destinations[group.key] === NEW_PROJECT,
  );
  const ready = foldersReady(draft, groups, chats, knownProjectIds);
  const shown = groups.filter((group) => {
    const titles = (byProject.get(group.key) ?? []).map((chat) => chat.title);
    return projectQueryMatches(
      group.source.title,
      group.source.repository?.canonicalKey ?? group.source.workspacePath,
      titles,
      query,
    );
  });
  const setDraft = (next: ImportDraft) => onDraft(next);
  return (
    <Dialog
      open={session.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title="Import chats"
          description={`${chats.length} chats from ${groups.length} source projects in ${session.fileLabel}. Pick what to bring and where it goes. You can close this and continue later.`}
        >
          <WizardSteps
            steps={IMPORT_STEPS}
            currentStep={draft.step}
            summaries={[
              `${remaining.length} chats`,
              createsProjects ? "New folders" : "Existing projects",
              null,
            ]}
            isStepDisabled={(index) => busy || index > draft.step}
            onStepChange={(step) => setDraft({ ...draft, step })}
          />
        </WizardHeader>
        <WizardPanel>
          {draft.step === 0 ? (
            <ChatStep
              groups={shown}
              byProject={byProject}
              draft={draft}
              query={query}
              expanded={expanded}
              busy={busy}
              onQuery={setQuery}
              onExpanded={setExpanded}
              onDraft={setDraft}
              projectKeys={groups.map((group) => group.key)}
            />
          ) : null}
          {draft.step === 1 ? (
            <FolderStep
              session={session}
              groups={groups.filter((group) => remainingKeys.has(group.key))}
              byProject={byProject}
              createsProjects={createsProjects}
              canCreate={canCreate}
              busy={busy}
              onDraft={setDraft}
              candidates={candidates}
            />
          ) : null}
          {draft.step === 2 ? (
            <ConfirmStep
              session={session}
              groups={groups.filter((group) => remainingKeys.has(group.key))}
              candidates={candidates}
              remaining={remaining.length}
              done={draft.doneChats.size}
              canMove={canMove}
              busy={busy}
              onDraft={setDraft}
            />
          ) : null}
          {session.status ? (
            <p role="status" className="text-sm text-muted-foreground">
              {session.status}
            </p>
          ) : null}
        </WizardPanel>
        <WizardFooter
          leading={
            <p className="text-sm text-muted-foreground">
              {remaining.length} to import
              {draft.doneChats.size > 0 ? ` · ${draft.doneChats.size} already done` : ""}
            </p>
          }
        >
          {draft.step > 0 ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDraft({ ...draft, step: draft.step - 1 })}
            >
              Back
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Import later
            </Button>
          )}
          {draft.step < 2 ? (
            <Button
              disabled={
                busy ||
                (draft.step === 0
                  ? remaining.length === 0
                  : !ready || (createsProjects && !canCreate))
              }
              onClick={() => setDraft({ ...draft, step: draft.step + 1 })}
            >
              Next
            </Button>
          ) : busy ? (
            <Button variant="outline" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button
              disabled={
                !allowed ||
                !ready ||
                (createsProjects && !canCreate) ||
                (draft.moveExisting && !canMove)
              }
              onClick={onImport}
            >
              {draft.doneChats.size > 0 ? "Continue import" : "Import chats"}
            </Button>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function ChatStep({
  groups,
  byProject,
  draft,
  query,
  expanded,
  busy,
  onQuery,
  onExpanded,
  onDraft,
  projectKeys,
}: {
  readonly groups: readonly ImportGroup[];
  readonly byProject: ReadonlyMap<string, readonly ImportChatRef[]>;
  readonly draft: ImportDraft;
  readonly query: string;
  readonly expanded: string | null;
  readonly busy: boolean;
  readonly onQuery: (query: string) => void;
  readonly onExpanded: (key: string | null) => void;
  readonly onDraft: (draft: ImportDraft) => void;
  readonly projectKeys: readonly string[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search source projects"
          placeholder="Search projects or chats"
          value={query}
          disabled={busy}
          onChange={(event) => onQuery(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onDraft(setAllProjects(draft, projectKeys, true))}
        >
          Select all
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onDraft(setAllProjects(draft, projectKeys, false))}
        >
          Select none
        </Button>
      </div>
      <div className="max-h-80 divide-y divide-border overflow-y-auto">
        {groups.map((group) => {
          const projectChats = byProject.get(group.key) ?? [];
          const selection = projectSelection(
            draft,
            group.key,
            projectChats.map((chat) => chat.id),
          );
          const sourcePath = group.source.repository?.canonicalKey ?? group.source.workspacePath;
          const queryMatchesChat =
            query.trim() !== "" &&
            !group.source.title.toLowerCase().includes(query.trim().toLowerCase()) &&
            !sourcePath.toLowerCase().includes(query.trim().toLowerCase());
          const open = expanded === group.key || queryMatchesChat;
          const visibleChats = queryMatchesChat
            ? projectChats.filter((chat) =>
                chat.title.toLowerCase().includes(query.trim().toLowerCase()),
              )
            : projectChats;
          return (
            <div key={group.key} className="py-3">
              <div className="flex min-w-0 items-start gap-2">
                <Checkbox
                  aria-label={`Import ${group.source.title}`}
                  checked={selection === "all" || selection === "done"}
                  indeterminate={selection === "some"}
                  disabled={busy || selection === "done"}
                  onCheckedChange={() =>
                    onDraft(
                      toggleProject(
                        draft,
                        group.key,
                        projectChats.map((chat) => chat.id),
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  aria-expanded={open}
                  onClick={() => onExpanded(open ? null : group.key)}
                >
                  <ChevronRightIcon
                    className={`mt-0.5 size-4 shrink-0 text-muted-foreground ${open ? "rotate-90" : ""}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{group.source.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {`Source project · ${sourcePath || "No folder recorded"} · ${group.count} ${group.count === 1 ? "chat" : "chats"}${selection === "done" ? " · imported" : ""}`}
                    </span>
                  </span>
                </button>
              </div>
              {open ? (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pl-6">
                  {visibleChats.map((chat) => {
                    const done = draft.doneChats.has(chat.id);
                    return (
                      <li key={chat.id} className="flex min-w-0 items-start gap-2">
                        <Checkbox
                          aria-label={`Import ${chat.title} from ${chat.projectTitle}`}
                          checked={done || chatIncluded(draft, chat.projectKey, chat.id)}
                          disabled={busy || done}
                          onCheckedChange={() =>
                            onDraft(
                              toggleChat(
                                draft,
                                group.key,
                                chat.id,
                                projectChats.map((item) => item.id),
                              ),
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{chat.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            From {chat.projectTitle}
                            {done ? " · imported" : ""}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
        {groups.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No projects match that search.</p>
        ) : null}
      </div>
    </div>
  );
}

function FolderStep({
  session,
  groups,
  byProject,
  createsProjects,
  canCreate,
  busy,
  onDraft,
  candidates,
}: {
  readonly session: ImportSession;
  readonly groups: readonly ImportGroup[];
  readonly byProject: ReadonlyMap<string, readonly ImportChatRef[]>;
  readonly createsProjects: boolean;
  readonly canCreate: boolean;
  readonly busy: boolean;
  readonly onDraft: (draft: ImportDraft) => void;
  readonly candidates: readonly { readonly id: string; readonly title: string }[];
}) {
  const { draft } = session;
  return (
    <div className="space-y-4">
      {createsProjects ? (
        <div className="space-y-2">
          <Label htmlFor="chat-import-base-folder">Projects folder</Label>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id="chat-import-base-folder"
              value={draft.baseDirectory}
              placeholder="~/Projects"
              disabled={busy}
              onChange={(event) => onDraft({ ...draft, baseDirectory: event.target.value })}
            />
            <WorkspaceFolderPicker
              environmentId={session.environmentId}
              value={draft.baseDirectory}
              disabled={busy}
              onChange={(baseDirectory) => onDraft({ ...draft, baseDirectory })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Each source project that needs a new folder gets one inside this directory. Existing
            folders are kept.
          </p>
          {!canCreate ? (
            <p role="alert" className="text-sm text-muted-foreground">
              This connection cannot create projects. Choose an existing project for each source.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="max-h-80 divide-y divide-border overflow-y-auto">
        {groups.map((group) => {
          const count = (byProject.get(group.key) ?? []).filter(
            (chat) => !draft.doneChats.has(chat.id) && chatIncluded(draft, group.key, chat.id),
          ).length;
          const destination = draft.destinations[group.key] ?? NEW_PROJECT;
          const sourcePath = group.source.repository?.canonicalKey ?? group.source.workspacePath;
          return (
            <div key={group.key} className="grid min-w-0 gap-3 py-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{group.source.title}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {`From ${sourcePath || "an unknown folder"} · ${count} ${count === 1 ? "chat" : "chats"}`}
                </p>
              </div>
              <div className="min-w-0 space-y-2">
                <Select
                  value={destination}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (!value) return;
                    onDraft({
                      ...draft,
                      destinations: { ...draft.destinations, [group.key]: value },
                    });
                  }}
                >
                  <SelectTrigger size="sm" aria-label={`Folder for ${group.source.title}`}>
                    <SelectValue>
                      {destination === NEW_PROJECT
                        ? "New folder"
                        : (candidates.find((project) => project.id === destination)?.title ??
                          "Choose a project")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NEW_PROJECT}>New folder</SelectItem>
                    {candidates.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {destination === NEW_PROJECT ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {draft.baseDirectory.trim()
                      ? getCloneDestinationPath(draft.baseDirectory.trim(), group.folderName)
                      : group.folderName}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmStep({
  session,
  groups,
  candidates,
  remaining,
  done,
  canMove,
  busy,
  onDraft,
}: {
  readonly session: ImportSession;
  readonly groups: readonly ImportGroup[];
  readonly candidates: readonly { readonly id: string; readonly title: string }[];
  readonly remaining: number;
  readonly done: number;
  readonly canMove: boolean;
  readonly busy: boolean;
  readonly onDraft: (draft: ImportDraft) => void;
}) {
  const { draft } = session;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {`${remaining} ${remaining === 1 ? "chat" : "chats"} from ${groups.length} source ${groups.length === 1 ? "project" : "projects"}${done > 0 ? `. ${done} from this backup ${done === 1 ? "is" : "are"} already imported and will be skipped.` : "."}`}
      </p>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto">
        {groups.map((group) => {
          const destination = draft.destinations[group.key] ?? NEW_PROJECT;
          const place =
            destination === NEW_PROJECT
              ? draft.baseDirectory.trim()
                ? getCloneDestinationPath(draft.baseDirectory.trim(), group.folderName)
                : group.folderName
              : (candidates.find((project) => project.id === destination)?.title ?? destination);
          return (
            <li key={group.key} className="py-2 text-sm">
              <span className="font-medium">{group.source.title}</span>
              <span className="text-muted-foreground"> → {place}</span>
            </li>
          );
        })}
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={draft.moveExisting}
          disabled={busy || !canMove}
          onCheckedChange={(checked) => onDraft({ ...draft, moveExisting: checked === true })}
        />
        Move existing imported chats into the folders chosen above
      </label>
    </div>
  );
}
