import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { CommandId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PlusIcon } from "lucide-react";
import { type RefObject, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  pickTaskHomeProject,
  TASK_TEXT_MAX_LENGTH,
  taskCaptureProjectKey,
  taskKey,
  type TaskProjectGroup,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

const LastProject = Schema.NullOr(Schema.String);

/** Type and press Enter: a task lands in the chosen project and the field is ready again. */
export function TaskCapture({
  groups,
  filterProjectKey,
  inputRef,
  onCreated,
}: {
  groups: ReadonlyArray<TaskProjectGroup>;
  filterProjectKey: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onCreated: (key: string) => void;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const labelOf = useEnvironmentLabel();
  const [lastProject, setLastProject] = useLocalStorage(
    "t3code:tasks:capture-project",
    null,
    LastProject,
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const storable = groups.filter((group) =>
    group.members.some((member) => member.reachable && member.project.savedPrompts !== undefined),
  );
  const projectKey = taskCaptureProjectKey(storable, [chosen, filterProjectKey, lastProject]);
  const group = storable.find((candidate) => candidate.key === projectKey) ?? null;
  const home = group ? pickTaskHomeProject(group, primaryEnvironmentId, labelOf) : null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <PlusIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {home ? (
          <CaptureInput
            home={home}
            inputRef={inputRef}
            onCreated={(key) => {
              if (group) setLastProject(group.key);
              onCreated(key);
            }}
          />
        ) : (
          <Input
            ref={inputRef}
            size="compact"
            aria-label="New task"
            placeholder="Connect a machine with a project to add tasks"
            disabled
          />
        )}
      </div>
      <div className="w-40 min-w-0 shrink-0">
        <Select
          value={projectKey ?? ""}
          onValueChange={(value) => {
            setChosen(value || null);
            inputRef.current?.focus();
          }}
        >
          <SelectTrigger size="compact" aria-label="Project for new tasks">
            <SelectValue>
              {(value: string) =>
                storable.find((candidate) => candidate.key === value)?.label ?? "Project"
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
    </div>
  );
}

function CaptureInput({
  home,
  inputRef,
  onCreated,
}: {
  home: EnvironmentProject;
  inputRef: RefObject<HTMLInputElement | null>;
  onCreated: (key: string) => void;
}) {
  const allowed = useAtomValue(
    projectEnvironment.tasks.quickCreate.permissionAtom(home.environmentId),
  );
  const create = useAtomCommand(projectEnvironment.tasks.quickCreate);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const value = text.trim();
    if (!allowed || busy || value.length === 0) return;
    setBusy(true);
    const commandId = CommandId.make(randomUUID());
    const result = await create({
      home: scopeProjectRef(home.environmentId, home.id),
      commandId,
      text: value,
    });
    setBusy(false);
    if (result._tag !== "Success") return;
    setText("");
    onCreated(taskKey(home.environmentId, home.id, commandId));
    inputRef.current?.focus();
  };
  return (
    <Input
      ref={inputRef}
      size="compact"
      aria-label="New task"
      placeholder={allowed ? "Add a task and press Enter" : "View only"}
      disabled={!allowed}
      maxLength={TASK_TEXT_MAX_LENGTH}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
