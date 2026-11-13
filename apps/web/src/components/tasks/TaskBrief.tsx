import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  type EnvironmentId,
  type RuntimeMode,
  type SavedPromptAction,
  type TaskRunSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  PlusIcon,
  ServerIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { cn } from "../../lib/utils";
import { resolveEnvModeLabel } from "../BranchToolbar.logic";
import { ComposerControl } from "../chat/ComposerControl";
import {
  resolveRuntimeModeOptions,
  runtimeModeConfig,
  runtimeModeOptions,
} from "../chat/runtimeModeConfig";
import { useManagedPolicy } from "../../state/managedPolicy";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { RelativeTime } from "../RelativeTime";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { TaskPriorityChip } from "./TaskFields";
import {
  editTaskCriteria,
  TASK_CRITERIA_MAX_COUNT,
  TASK_RUN_WITH_ANCHOR,
  TASK_CRITERION_MAX_LENGTH,
  TASK_STATUS_LABELS,
  taskAttempts,
  taskPriority,
  taskRunProject,
  taskStartTargets,
  taskTitle,
  type TaskCriteriaEdit,
  type TaskCriterion,
  type TaskEntry,
  type TaskProjectGroup,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

function BriefSection({
  id,
  title,
  detail,
  action,
  children,
}: {
  id?: string;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="flex min-w-0 flex-col gap-1 scroll-mt-2">
      <header className="flex h-7 min-w-0 items-center gap-2 px-1">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {detail ? (
          <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
        ) : null}
        {action ? <span className="ml-auto flex items-center">{action}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** A checklist the agent receives with the prompt; drag or Alt+↑↓ to reorder. */
export function TaskCriteriaEditor({
  criteria,
  disabled,
  onChange,
}: {
  criteria: ReadonlyArray<TaskCriterion>;
  disabled: boolean;
  onChange: (criteria: TaskCriterion[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const apply = (edit: TaskCriteriaEdit) => {
    const next = editTaskCriteria(criteria, edit);
    if (next !== null) onChange(next);
    return next !== null;
  };
  const ids = criteria.map((_, index) => `criterion-${index}`);
  const onDragEnd = (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over?.id));
    if (from !== -1 && to !== -1) apply({ kind: "move", from, to });
  };
  const full = criteria.length >= TASK_CRITERIA_MAX_COUNT;
  return (
    <BriefSection
      title="Acceptance criteria"
      detail={
        criteria.length > 0
          ? `${criteria.filter((item) => item.done).length}/${criteria.length}`
          : null
      }
    >
      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col">
            {criteria.map((item, index) => (
              <CriterionRow
                // Criteria have no ids; the index is their identity within one render.
                // oxlint-disable-next-line react/no-array-index-key
                key={`${index}:${item.text}`}
                id={ids[index]!}
                item={item}
                index={index}
                count={criteria.length}
                disabled={disabled}
                onEdit={apply}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {disabled || full ? (
        full ? (
          <p className="px-1 text-xs text-muted-foreground">
            {TASK_CRITERIA_MAX_COUNT} criteria at most.
          </p>
        ) : null
      ) : (
        <div className="flex h-8 items-center gap-2 pl-6">
          <Input
            size="compact"
            aria-label="Add acceptance criterion"
            placeholder="Add a criterion and press Enter"
            maxLength={TASK_CRITERION_MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (apply({ kind: "add", text: draft })) setDraft("");
              }
            }}
          />
        </div>
      )}
    </BriefSection>
  );
}

function CriterionRow({
  id,
  item,
  index,
  count,
  disabled,
  onEdit,
}: {
  id: string;
  item: TaskCriterion;
  index: number;
  count: number;
  disabled: boolean;
  onEdit: (edit: TaskCriteriaEdit) => boolean;
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id,
    disabled,
  });
  const [text, setText] = useState(item.text);
  return (
    <li
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate3d(0, ${Math.round(transform.y)}px, 0)`, transition }
          : undefined
      }
      className={cn(
        "group/criterion flex h-8 min-w-0 items-center gap-1 rounded-md pr-1 has-focus-visible:ring-1 has-focus-visible:ring-ring has-focus-visible:ring-inset",
        isDragging ? "z-10 bg-accent shadow-md" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        aria-label="Reorder criterion"
        disabled={disabled}
        className="flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground opacity-0 group-hover/criterion:opacity-100 disabled:hidden"
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <Checkbox
        aria-label={item.done ? "Mark criterion not met" : "Mark criterion met"}
        checked={item.done}
        disabled={disabled}
        onCheckedChange={() => onEdit({ kind: "toggle", index })}
      />
      <input
        aria-label={`Criterion ${index + 1}`}
        className={cn(
          "h-8 min-w-0 flex-1 truncate bg-transparent px-1.5 text-sm outline-none",
          item.done && "text-muted-foreground line-through decoration-muted-foreground/50",
        )}
        maxLength={TASK_CRITERION_MAX_LENGTH}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (!onEdit({ kind: "edit", index, text })) setText(item.text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") {
            setText(item.text);
            event.currentTarget.blur();
          } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            const to = index + (event.key === "ArrowUp" ? -1 : 1);
            if (to >= 0 && to < count) onEdit({ kind: "move", from: index, to });
          }
        }}
      />
      {disabled ? null : (
        <span className="flex opacity-0 group-hover/criterion:opacity-100 group-has-focus-visible/criterion:opacity-100">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Remove criterion"
            tabIndex={-1}
            onClick={() => onEdit({ kind: "remove", index })}
          >
            <XIcon />
          </Button>
        </span>
      )}
    </li>
  );
}

function ChoiceMenu<V extends string>({
  label,
  value,
  options,
  disabled,
  icon,
  onChange,
}: {
  label: string;
  value: V;
  options: ReadonlyArray<{
    readonly value: V;
    readonly label: string;
    readonly disabled?: string | null;
  }>;
  disabled: boolean;
  icon?: ReactNode;
  onChange: (value: V) => void;
}) {
  const current = options.find((option) => option.value === value)?.label ?? value;
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <ComposerControl
            size="xs"
            className={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            aria-label={`${label}: ${current}`}
          />
        }
      >
        {icon}
        <span className="max-w-32 truncate">{current}</span>
        <ChevronDownIcon data-composer-control-chevron />
      </MenuTrigger>
      <MenuPopup align="start" className="max-w-72">
        <MenuRadioGroup value={value} onValueChange={(next: V) => next !== value && onChange(next)}>
          {options.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              disabled={Boolean(option.disabled)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <MenuRadioItemIndicator className="w-3.5" />
                <span className="truncate">{option.label}</span>
                {option.disabled ? (
                  <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                    {option.disabled}
                  </span>
                ) : null}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** The saved launch settings as chips, each edited with the app's own pickers. */
export function TaskRunWith({
  entry,
  group,
  disabled,
  onChange,
}: {
  entry: TaskEntry;
  group: TaskProjectGroup;
  disabled: boolean;
  onChange: (settings: TaskRunSettings | null) => void;
}) {
  const labelOf = useEnvironmentLabel();
  const saved = entry.task.runSettings ?? null;
  const target = taskRunProject(entry, group);
  const environmentId = target.environmentId;
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const navigate = useNavigate();
  const defaults = resolveProjectSettings(settings, target.id, target).settings;
  const entries = providerInstanceEntriesFor(providers, settings, target.id);
  const selection =
    saved?.defaultModelSelection ??
    defaults.defaultModelSelection ??
    resolveProjectDefaultProviderModelSelection(providers, settings, target.id) ??
    null;
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const activeEntry = entries.find((candidate) => candidate.instanceId === selection?.instanceId);
  const set = (patch: Partial<TaskRunSettings>) => onChange({ ...saved, ...patch });
  const machines = taskStartTargets(group, entry, labelOf);
  const runtimeMode: RuntimeMode = saved?.runtimeMode ?? defaults.defaultRuntimeMode;
  const envMode = saved?.threadEnvMode ?? defaults.defaultThreadEnvMode ?? "local";
  const runtimeOptions = resolveRuntimeModeOptions(
    runtimeModeOptions,
    useManagedPolicy(environmentId),
  );
  const PermissionIcon = runtimeModeConfig[runtimeMode].icon;
  return (
    <BriefSection
      id={TASK_RUN_WITH_ANCHOR}
      title="Run with"
      detail={saved === null ? "Project default" : null}
      action={
        saved !== null && !disabled ? (
          <Button size="micro" variant="ghost-muted" onClick={() => onChange(null)}>
            Use project default
          </Button>
        ) : null
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1">
        {selection ? (
          <ProviderModelPicker
            environmentId={environmentId}
            activeInstanceId={selection.instanceId}
            model={selection.model}
            lockedProvider={null}
            instanceEntries={entries}
            modelOptionsByInstance={modelOptions}
            size="xs"
            disabled={disabled}
            triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            onOpenProviderSetup={(instanceId) =>
              void navigate({ to: "/settings/providers", search: { environmentId, instanceId } })
            }
            onInstanceModelChange={(instanceId, model) =>
              set({ defaultModelSelection: createModelSelection(instanceId, model) })
            }
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            No providers on {labelOf(environmentId)}
          </span>
        )}
        {selection && activeEntry ? (
          <TraitsPicker
            provider={activeEntry.driverKind}
            models={activeEntry.models}
            model={selection.model}
            modelOptions={selection.options ?? []}
            allowPromptInjectedEffort={false}
            triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            onModelOptionsChange={(options) =>
              set({
                defaultModelSelection: createModelSelection(
                  selection.instanceId,
                  selection.model,
                  options,
                ),
              })
            }
          />
        ) : null}
        {machines.length > 1 ? (
          <ChoiceMenu<EnvironmentId>
            label="Machine"
            icon={<ServerIcon />}
            value={environmentId}
            disabled={disabled}
            options={machines.map((machine) => ({
              value: machine.project.environmentId,
              label: labelOf(machine.project.environmentId),
              disabled: machine.disabledReason,
            }))}
            onChange={(value) =>
              set({ targetEnvironmentId: value === entry.home.environmentId ? undefined : value })
            }
          />
        ) : null}
        <ChoiceMenu<"local" | "worktree">
          label="Workspace"
          value={envMode}
          disabled={disabled}
          options={(["local", "worktree"] as const).map((mode) => ({
            value: mode,
            label: resolveEnvModeLabel(mode),
          }))}
          onChange={(threadEnvMode) => set({ threadEnvMode })}
        />
        <ChoiceMenu<RuntimeMode>
          label="Permissions"
          icon={<PermissionIcon />}
          value={runtimeMode}
          disabled={disabled}
          options={runtimeOptions.map((option) => ({
            value: option.mode,
            label: option.label,
            disabled: "disabledReason" in option ? option.disabledReason : null,
          }))}
          onChange={(mode) => set({ runtimeMode: mode })}
        />
      </div>
    </BriefSection>
  );
}

/** A parent's subtasks with their progress; one level, on the parent's machine. */
export function TaskSubtasks({
  entry,
  subtasks,
  parent,
  disabled,
  onAdd,
  onUpdate,
  onOpen,
}: {
  entry: TaskEntry;
  subtasks: ReadonlyArray<TaskEntry>;
  /** The parent when this task is itself a subtask. */
  parent: TaskEntry | null;
  disabled: boolean;
  onAdd: (titles: ReadonlyArray<string>) => Promise<boolean>;
  onUpdate: (action: SavedPromptAction) => void;
  onOpen: (key: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  if (parent) {
    return (
      <div className="flex h-7 min-w-0 items-center gap-1 px-1 text-xs text-muted-foreground">
        <span className="shrink-0">Subtask of</span>
        <Button size="micro" variant="ghost" onClick={() => onOpen(parent.key)}>
          <span className="max-w-60 truncate">{taskTitle(parent.task)}</span>
        </Button>
      </div>
    );
  }
  const criteria = (entry.task.acceptanceCriteria ?? []).filter((item) => !item.done);
  const done = subtasks.filter((item) => item.status === "done").length;
  const addButton = disabled ? null : (
    <Menu>
      <MenuTrigger render={<Button size="micro" variant="ghost-muted" />}>
        <PlusIcon />
        {subtasks.length === 0 ? "Split into subtasks" : "Add subtask"}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => setAdding(true)}>Write subtasks…</MenuItem>
        <MenuItem
          disabled={criteria.length === 0}
          onClick={() => void onAdd(criteria.map((item) => item.text))}
        >
          One per open criterion
          {criteria.length > 0 ? (
            <span className="ms-auto ps-4 text-xs text-muted-foreground tabular-nums">
              {criteria.length}
            </span>
          ) : null}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
  if (subtasks.length === 0 && !adding) {
    return (
      <BriefSection title="Subtasks" action={addButton}>
        {null}
      </BriefSection>
    );
  }
  return (
    <BriefSection
      title="Subtasks"
      detail={subtasks.length > 0 ? `${done}/${subtasks.length}` : null}
      action={addButton}
    >
      <ul className="flex flex-col">
        {subtasks.map((child) => (
          <li
            key={child.key}
            className="flex h-8 min-w-0 items-center gap-2 rounded-md pr-1 pl-6 hover:bg-accent/50"
          >
            <Checkbox
              aria-label={child.status === "done" ? "Reopen subtask" : "Mark subtask done"}
              checked={child.status === "done"}
              disabled={disabled}
              onCheckedChange={() =>
                onUpdate({ kind: "complete", id: child.task.id, done: child.status !== "done" })
              }
            />
            <span className="flex w-6 shrink-0 justify-center">
              <TaskPriorityChip priority={taskPriority(child.task)} />
            </span>
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 truncate rounded-sm text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                child.status === "done" &&
                  "text-muted-foreground line-through decoration-muted-foreground/50",
              )}
              onClick={() => onOpen(child.key)}
            >
              {taskTitle(child.task)}
            </button>
            {child.status !== "open" && child.status !== "done" ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {TASK_STATUS_LABELS[child.status]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex h-8 items-center gap-2 pl-6">
          <Input
            size="compact"
            autoFocus
            aria-label="New subtask"
            placeholder="Subtask title, Enter to add, Esc to finish"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (!draft.trim()) setAdding(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && draft.trim()) {
                event.preventDefault();
                const title = draft.trim();
                setDraft("");
                void onAdd([title]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft("");
                setAdding(false);
              }
            }}
          />
        </div>
      ) : null}
    </BriefSection>
  );
}

/** Every attempt at the task, newest first, each opening its thread. */
export function TaskHistory({ entry }: { entry: TaskEntry }) {
  const labelOf = useEnvironmentLabel();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const attempts = taskAttempts(entry.task, entry.home.environmentId);
  if (attempts.length === 0) return null;
  const visible = expanded ? attempts : attempts.slice(0, 3);
  return (
    <BriefSection title="History" detail={`${attempts.length}`}>
      <ol className="flex flex-col">
        {visible.map((attempt, index) => (
          <li key={attempt.key}>
            <button
              type="button"
              className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(attempt.thread),
                })
              }
            >
              <span className="w-16 shrink-0 text-muted-foreground tabular-nums">
                Attempt {attempts.length - index}
              </span>
              {attempt.review ? (
                <Badge variant={attempt.review.tone} size="sm">
                  {attempt.review.outcome}
                </Badge>
              ) : (
                <Badge variant="quiet" size="sm">
                  {index === 0 && entry.status === "in-progress" ? "Running" : "No result"}
                </Badge>
              )}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {[
                  attempt.review?.duration,
                  attempt.review?.changes?.label,
                  ...(attempt.review?.pullRequests.map((pr) => `#${pr.number}`) ?? []),
                  attempt.remote ? labelOf(attempt.thread.environmentId) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {attempt.finishedAt ? (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  <RelativeTime timestamp={attempt.finishedAt} />
                </span>
              ) : null}
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ol>
      {attempts.length > 3 ? (
        <Button size="micro" variant="ghost-muted" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${attempts.length}`}
        </Button>
      ) : null}
    </BriefSection>
  );
}
