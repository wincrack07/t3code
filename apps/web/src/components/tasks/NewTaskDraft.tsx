import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { type RefObject, useEffect, useRef, useState } from "react";

import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { cn, randomUUID } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  pickTaskHomeProject,
  TASK_TEXT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  taskKey,
  type TaskProjectGroup,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

export interface NewTaskSeed {
  readonly prompt: string;
  readonly title: string | null;
  readonly projectKey: string | null;
}

/** A task that exists only here until Save; the deep link and "New task" both open it. */
export function NewTaskDraft({
  groups,
  seed,
  onSaved,
  onDiscard,
}: {
  groups: ReadonlyArray<TaskProjectGroup>;
  seed: NewTaskSeed;
  onSaved: (key: string) => void;
  onDiscard: () => void;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const labelOf = useEnvironmentLabel();
  const storable = groups.filter((group) =>
    group.members.some((member) => member.reachable && member.project.savedPrompts !== undefined),
  );
  const [projectKey, setProjectKey] = useState(
    storable.some((group) => group.key === seed.projectKey) ? seed.projectKey : null,
  );
  const [machine, setMachine] = useState<EnvironmentId | null>(null);
  const [title, setTitle] = useState(seed.title ?? "");
  const [text, setText] = useState(seed.prompt);
  const group = storable.find((candidate) => candidate.key === projectKey) ?? null;
  const machines = (group?.members ?? []).filter(
    (member) => member.reachable && member.project.savedPrompts !== undefined,
  );
  const home =
    machines.find((member) => member.project.environmentId === machine)?.project ??
    (group ? pickTaskHomeProject(group, primaryEnvironmentId, labelOf) : null);
  const valid =
    text.trim().length > 0 &&
    text.length <= TASK_TEXT_MAX_LENGTH &&
    title.length <= TASK_TITLE_MAX_LENGTH;
  const draft = { text: text.trim(), title: title.trim() || null };
  const saveRef = useRef<(() => void) | null>(null);
  return (
    <section aria-label="New task" className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      <input
        aria-label="Task title"
        className="h-8 min-w-0 rounded-md bg-transparent px-1 text-base font-medium outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        placeholder="New task"
        maxLength={TASK_TITLE_MAX_LENGTH}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="-mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <div className="w-48 min-w-0">
          <Select
            value={projectKey ?? ""}
            onValueChange={(value) => {
              setProjectKey(value || null);
              setMachine(null);
            }}
          >
            <SelectTrigger size="compact" aria-label="Project">
              <SelectValue>
                {(value: string) =>
                  storable.find((candidate) => candidate.key === value)?.label ?? "Choose a project"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {storable.map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {group ? (
          <div className="w-40 min-w-0">
            <Select
              value={home?.environmentId ?? ""}
              disabled={machines.length < 2}
              onValueChange={(value) => setMachine((value as EnvironmentId) || null)}
            >
              <SelectTrigger size="compact" aria-label="Machine that stores the task">
                <SelectValue>
                  {(value: string) => (value ? labelOf(value as EnvironmentId) : "No machine")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {machines.map((member) => (
                  <SelectItem
                    key={member.project.environmentId}
                    value={member.project.environmentId}
                  >
                    {labelOf(member.project.environmentId)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border has-focus-visible:border-ring">
        <textarea
          aria-label="Task prompt"
          autoFocus
          className="min-h-0 flex-1 resize-none rounded-lg bg-transparent px-3 py-2.5 text-sm leading-6 outline-none"
          placeholder="What should the agent do?"
          value={text}
          maxLength={TASK_TEXT_MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              saveRef.current?.();
            }
          }}
        />
      </div>
      <div className="flex h-4 items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span className={cn("truncate", group && !home && "text-destructive-foreground")}>
          {!group
            ? "Choose a project to save this task."
            : !home
              ? "None of this project's machines is reachable."
              : `Not saved yet · stored on ${labelOf(home.environmentId)}`}
        </span>
        <span className="shrink-0 tabular-nums">
          {text.length.toLocaleString()} / {TASK_TEXT_MAX_LENGTH.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button size="compact" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        {home ? (
          <SaveTaskButton
            home={home}
            draft={draft}
            valid={valid}
            saveRef={saveRef}
            onSaved={onSaved}
          />
        ) : (
          <Button size="compact" disabled>
            Save task
          </Button>
        )}
      </div>
    </section>
  );
}

function SaveTaskButton({
  home,
  draft,
  valid,
  saveRef,
  onSaved,
}: {
  home: EnvironmentProject;
  draft: { readonly text: string; readonly title: string | null };
  valid: boolean;
  saveRef: RefObject<(() => void) | null>;
  onSaved: (key: string) => void;
}) {
  const { allowed, update } = useSavedPrompts(home.environmentId, home.id);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!valid || !allowed || busy) return;
    setBusy(true);
    const id = randomUUID();
    const ok = await update({ kind: "add", id, text: draft.text, title: draft.title });
    setBusy(false);
    if (ok) onSaved(taskKey(home.environmentId, home.id, id));
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the editor's Mod+Enter the current save for this machine
  useEffect(() => {
    saveRef.current = () => void save();
  });
  return (
    <Button size="compact" disabled={!valid || !allowed || busy} onClick={() => void save()}>
      {busy ? "Saving…" : "Save task"}
    </Button>
  );
}
