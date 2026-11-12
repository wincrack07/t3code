import type { SavedPromptAction } from "@t3tools/contracts";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  normalizeTaskTags,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_TAG_MAX_COUNT,
  TASK_TAG_MAX_LENGTH,
  TASK_WHEN_LABELS,
  taskPriority,
  taskWhen,
  type TaskEntry,
  type TaskPriority,
  type TaskWhen,
} from "./tasks.logic";

export const TASK_PRIORITY_BADGE = {
  p1: "error",
  p2: "secondary",
  p3: "quiet",
} as const satisfies Record<TaskPriority, "error" | "secondary" | "quiet">;

export function TaskPriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <Badge variant={TASK_PRIORITY_BADGE[priority]} size="sm" aria-label={`Priority ${priority}`}>
      {TASK_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export const TASK_WHEN_ORDER = ["today", "later", "none"] as const satisfies readonly TaskWhen[];

/** The edits a row shortcut makes: 1/2/3 set priority, T toggles Today. */
export function taskShortcutAction(
  entry: Pick<TaskEntry, "task">,
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): SavedPromptAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const priority = ({ "1": "p1", "2": "p2", "3": "p3" } as const)[event.key as "1" | "2" | "3"];
  if (priority !== undefined)
    return taskPriority(entry.task) === priority
      ? null
      : { kind: "edit", id: entry.task.id, priority };
  if (event.key === "t" || event.key === "T")
    return {
      kind: "edit",
      id: entry.task.id,
      when: taskWhen(entry.task) === "today" ? "none" : "today",
    };
  return null;
}

/** Priority, when and tags as menu items, shared by the row menu and the detail. */
export function TaskFieldMenuItems({
  entry,
  tagsInUse,
  onUpdate,
  onEditTags,
}: {
  entry: TaskEntry;
  tagsInUse: ReadonlyArray<string>;
  onUpdate: (action: SavedPromptAction) => void;
  onEditTags: (() => void) | null;
}) {
  const { task } = entry;
  const tags = task.tags ?? [];
  const options = [...new Set([...tags, ...tagsInUse])].toSorted();
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>Priority</MenuGroupLabel>
        <MenuRadioGroup
          value={taskPriority(task)}
          onValueChange={(value: TaskPriority) =>
            onUpdate({ kind: "edit", id: task.id, priority: value })
          }
        >
          {TASK_PRIORITIES.map((value, index) => (
            <MenuRadioItem key={value} value={value} closeOnClick>
              <span className="flex items-center gap-2">
                <MenuRadioItemIndicator className="w-3.5" />
                {TASK_PRIORITY_LABELS[value]}
                <MenuShortcut>{index + 1}</MenuShortcut>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>When</MenuGroupLabel>
        <MenuRadioGroup
          value={taskWhen(task)}
          onValueChange={(value: TaskWhen) => onUpdate({ kind: "edit", id: task.id, when: value })}
        >
          {TASK_WHEN_ORDER.map((value) => (
            <MenuRadioItem key={value} value={value} closeOnClick>
              <span className="flex items-center gap-2">
                <MenuRadioItemIndicator className="w-3.5" />
                {TASK_WHEN_LABELS[value]}
                {value === "today" ? <MenuShortcut>T</MenuShortcut> : null}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
      <MenuSeparator />
      <MenuSub>
        <MenuSubTrigger>Tags</MenuSubTrigger>
        <MenuSubPopup>
          {options.map((tag) => (
            <MenuCheckboxItem
              key={tag}
              checked={tags.includes(tag)}
              disabled={!tags.includes(tag) && tags.length >= TASK_TAG_MAX_COUNT}
              onCheckedChange={(checked) =>
                onUpdate({
                  kind: "edit",
                  id: task.id,
                  tags: checked ? [...tags, tag] : tags.filter((value) => value !== tag),
                })
              }
            >
              <span className="truncate">{tag}</span>
            </MenuCheckboxItem>
          ))}
          {options.length > 0 && onEditTags ? <MenuSeparator /> : null}
          {onEditTags ? <MenuItem onClick={onEditTags}>New tag…</MenuItem> : null}
        </MenuSubPopup>
      </MenuSub>
    </>
  );
}

/** A chip that opens a radio menu; used for priority and when in the detail. */
export function TaskChoiceChip<V extends string>({
  label,
  value,
  options,
  disabled,
  variant = "outline",
  onChange,
}: {
  label: string;
  value: V;
  options: ReadonlyArray<{ readonly value: V; readonly label: string }>;
  disabled: boolean;
  variant?: "outline" | "error" | "secondary" | "quiet";
  onChange: (value: V) => void;
}) {
  const current = options.find((option) => option.value === value)?.label ?? value;
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Badge
            variant={variant}
            size="control"
            render={<button type="button" aria-label={`${label}: ${current}`} />}
          />
        }
      >
        {current}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={value} onValueChange={(next: V) => next !== value && onChange(next)}>
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span className="flex items-center gap-2">
                <MenuRadioItemIndicator className="w-3.5" />
                {option.label}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** Tag chips with remove buttons and an inline field to add one. */
export function TaskTagsEditor({
  tags,
  suggestions,
  disabled,
  adding,
  onAddingChange,
  onChange,
}: {
  tags: ReadonlyArray<string>;
  suggestions: ReadonlyArray<string>;
  disabled: boolean;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const commit = () => {
    const next = normalizeTaskTags([...tags, ...draft.split(",")]);
    setDraft("");
    if (next.length !== tags.length) onChange(next);
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline" size="control" className="max-w-40">
          <span className="truncate">{tag}</span>
          {disabled ? null : (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter((value) => value !== tag))}
            >
              <XIcon />
            </Button>
          )}
        </Badge>
      ))}
      {adding ? (
        <div className="w-32">
          <Input
            size="compact"
            autoFocus
            aria-label="New tag"
            placeholder="Tag"
            maxLength={TASK_TAG_MAX_LENGTH}
            list={listId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              commit();
              onAddingChange(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft("");
                onAddingChange(false);
              } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
                onChange(tags.slice(0, -1));
              }
            }}
          />
          <datalist id={listId}>
            {suggestions
              .filter((tag) => !tags.includes(tag))
              .map((tag) => (
                <option key={tag} value={tag} />
              ))}
          </datalist>
        </div>
      ) : disabled || tags.length >= TASK_TAG_MAX_COUNT ? null : (
        <Button size="micro" variant="ghost-muted" onClick={() => onAddingChange(true)}>
          <PlusIcon />
          Tag
        </Button>
      )}
    </div>
  );
}
