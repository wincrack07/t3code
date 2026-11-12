import {
  SavedPromptAction,
  type ThreadId,
  type CommandId,
  type EventId,
  MAX_SCRIPT_ID_LENGTH,
  type ModelSelection,
  type ProjectIconOverride,
  ProjectId,
  type ProjectScript,
  SCRIPT_RUN_COMMAND_PATTERN,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { UnsequencedProjectEvent } from "../persistence/OrchestrationEventStore.ts";
import type { ProjectRow } from "./ProjectStore.ts";

export interface ProjectCreateCommand {
  readonly type: "project.create";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly scripts?: ReadonlyArray<ProjectScript>;
}

export interface ProjectMetaUpdateCommand {
  readonly savedPrompt?: SavedPromptAction;
  readonly savedPromptThread?: { readonly id: string; readonly threadId: ThreadId };
  readonly type: "project.meta.update";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly title?: string;
  readonly workspaceRoot?: string;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly defaultThreadEnvMode?: ThreadEnvMode | null;
  readonly autoPull?: boolean;
  readonly faviconPath?: string | null;
  readonly projectIcon?: ProjectIconOverride | null;
  readonly scripts?: ReadonlyArray<ProjectScript>;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

export interface ProjectDeleteCommand {
  readonly type: "project.delete";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export type ProjectCommand = ProjectCreateCommand | ProjectMetaUpdateCommand | ProjectDeleteCommand;

export class ProjectCommandInvariantError extends Schema.TaggedError<ProjectCommandInvariantError>()(
  "ProjectCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Project command invariant failed (${this.commandType}): ${this.detail}`;
  }
}

export class ProjectCommandMissingProjectError extends Schema.TaggedError<ProjectCommandMissingProjectError>()(
  "ProjectCommandMissingProjectError",
  {
    commandType: Schema.String,
    projectId: ProjectId,
  },
) {
  override get message(): string {
    return `Project '${this.projectId}' does not exist for command '${this.commandType}'.`;
  }
}

export class ProjectWorkspaceConflictError extends Schema.TaggedError<ProjectWorkspaceConflictError>()(
  "ProjectWorkspaceConflictError",
  {
    workspaceRoot: Schema.String,
    conflictingProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Active project '${this.conflictingProjectId}' already exists for workspace root '${this.workspaceRoot}'.`;
  }
}

export const ProjectCommandRejection = Schema.Union([
  ProjectCommandInvariantError,
  ProjectCommandMissingProjectError,
  ProjectWorkspaceConflictError,
]);
export type ProjectCommandRejection = typeof ProjectCommandRejection.Type;

const ProjectCommandRejectionJson = Schema.fromJsonString(ProjectCommandRejection);
export const encodeProjectCommandRejection = Schema.encodeSync(ProjectCommandRejectionJson);
export const decodeProjectCommandRejection = Schema.decodeUnknownOption(
  ProjectCommandRejectionJson,
);

export interface ProjectCommandState {
  readonly project: ProjectRow | undefined;
  readonly workspaceOwner: ProjectRow | undefined;
}

const monogramSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);
const isSavedPromptAction = Schema.is(SavedPromptAction);

/** Read state and commit the planned event under the project lock. */
export function planProjectCommand(input: {
  readonly command: ProjectCommand;
  readonly state: ProjectCommandState;
  readonly eventId: EventId;
  readonly now: DateTime.Utc;
}): Result.Result<UnsequencedProjectEvent, ProjectCommandRejection> {
  const { command, state } = input;
  const invariant = (detail: string) =>
    Result.fail(new ProjectCommandInvariantError({ commandType: command.type, detail }));
  const missingProject = () =>
    Result.fail(
      new ProjectCommandMissingProjectError({
        commandType: command.type,
        projectId: command.projectId,
      }),
    );
  const activeProject = state.project?.deletedAt === null ? state.project : undefined;
  const requireWorkspaceAvailable = (workspaceRoot: string) =>
    state.workspaceOwner === undefined || state.workspaceOwner.projectId === command.projectId
      ? undefined
      : new ProjectWorkspaceConflictError({
          workspaceRoot,
          conflictingProjectId: state.workspaceOwner.projectId,
        });
  const occurredAt = DateTime.formatIso(input.now);
  const base = {
    eventId: input.eventId,
    aggregateKind: "project" as const,
    aggregateId: command.projectId,
    occurredAt,
    commandId: command.commandId,
    causationEventId: null,
    correlationId: command.commandId,
    metadata: {},
  };

  switch (command.type) {
    case "project.create": {
      if (state.project !== undefined) {
        return invariant(
          `Project '${command.projectId}' already exists and cannot be created twice.`,
        );
      }
      const conflict = requireWorkspaceAvailable(command.workspaceRoot);
      if (conflict !== undefined) return Result.fail(conflict);
      return Result.succeed({
        ...base,
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: null,
          faviconPath: null,
          projectIcon: null,
          scripts: command.scripts ?? [],
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
    }

    case "project.meta.update": {
      const project = activeProject;
      if (project === undefined) return missingProject();
      if (
        command.projectIcon?.kind === "monogram" &&
        Array.from(monogramSegmenter.segment(command.projectIcon.text)).length > 2
      ) {
        return invariant("Project monograms must contain at most two characters.");
      }
      if (command.scripts !== undefined) {
        // Allow editing or removing persisted invalid script ids, while rejecting new invalid ids.
        const existingIds = new Set(project.scripts.map((script) => script.id));
        for (const script of command.scripts) {
          if (!existingIds.has(script.id) && !isScriptRunCommand(`script.${script.id}.run`)) {
            return invariant(
              `Script IDs must be 1-${MAX_SCRIPT_ID_LENGTH} lowercase letters, digits or hyphens, starting with a letter or digit (got ${script.id.length} characters).`,
            );
          }
        }
      }
      let savedPrompts = project.savedPrompts ?? [];
      const action = command.savedPrompt;
      if (action !== undefined) {
        if (!isSavedPromptAction(action))
          return invariant("Invalid saved prompt or size limit exceeded.");
        const exists = savedPrompts.some(
          (item) => item.id === ("id" in action ? action.id : undefined),
        );
        if (action.kind === "add") {
          if (exists) return invariant("A saved prompt with this id already exists.");
          if (savedPrompts.filter((item) => item.deletedAt === undefined).length >= 100)
            return invariant("Clear saved prompts before adding more (100 maximum).");
          savedPrompts = [
            {
              id: action.id,
              text: action.text,
              title: action.title ?? null,
              status: action.status ?? "open",
              createdAt: occurredAt,
              completedAt: action.status === "done" ? occurredAt : null,
            },
            ...savedPrompts,
          ];
        } else if (action.kind === "clear-done") {
          const completed = savedPrompts.filter(
            (item) => item.deletedAt === undefined && item.completedAt !== null,
          );
          savedPrompts = [
            ...completed.map((item) => ({ ...item, deletedAt: occurredAt })),
            ...savedPrompts.filter((item) => !completed.includes(item)),
          ];
        } else if (action.kind === "restore") {
          if (!exists) return invariant("The saved prompt can no longer be restored.");
          savedPrompts = savedPrompts.map((item) => {
            if (item.id !== action.id) return item;
            const { deletedAt: _deletedAt, ...restored } = item;
            return restored;
          });
        } else if (action.kind === "link") {
          if (!savedPrompts.some((item) => item.id === action.id && item.deletedAt === undefined))
            return invariant("The saved prompt no longer exists.");
          savedPrompts = savedPrompts.map((item) =>
            item.id !== action.id
              ? item
              : {
                  ...item,
                  status: "in-progress" as const,
                  completedAt: null,
                  latestThreadId: action.threadId,
                  latestThreadEnvironmentId: action.environmentId,
                  threadLinks: [
                    {
                      threadId: action.threadId,
                      ...(action.environmentId === undefined
                        ? {}
                        : { environmentId: action.environmentId }),
                    },
                    ...(
                      item.threadLinks ??
                      (item.latestThreadId === undefined
                        ? []
                        : [
                            {
                              threadId: item.latestThreadId,
                              ...(item.latestThreadEnvironmentId === undefined
                                ? {}
                                : { environmentId: item.latestThreadEnvironmentId }),
                            },
                          ])
                    ).filter(
                      (link) =>
                        link.threadId !== action.threadId ||
                        link.environmentId !== action.environmentId,
                    ),
                  ].slice(0, 10),
                },
          );
        } else {
          if (!savedPrompts.some((item) => item.id === action.id && item.deletedAt === undefined))
            return invariant("The saved prompt no longer exists.");
          savedPrompts =
            action.kind === "delete"
              ? [
                  ...savedPrompts
                    .filter((item) => item.id === action.id)
                    .map((item) => ({ ...item, deletedAt: occurredAt })),
                  ...savedPrompts.filter((item) => item.id !== action.id),
                ]
              : savedPrompts.map((item) =>
                  item.id !== action.id
                    ? item
                    : action.kind === "edit"
                      ? {
                          ...item,
                          ...(action.text === undefined ? {} : { text: action.text }),
                          ...(action.title === undefined ? {} : { title: action.title }),
                          ...(action.status === undefined
                            ? {}
                            : {
                                status: action.status,
                                completedAt:
                                  action.status === "done"
                                    ? (item.completedAt ?? occurredAt)
                                    : null,
                              }),
                        }
                      : {
                          ...item,
                          status: action.done ? ("done" as const) : ("open" as const),
                          completedAt: action.done ? (item.completedAt ?? occurredAt) : null,
                        },
                );
        }
      }
      if (command.savedPromptThread !== undefined) {
        const link = command.savedPromptThread;
        if (!savedPrompts.some((item) => item.id === link.id))
          return invariant("The saved prompt no longer exists.");
        savedPrompts = savedPrompts.map((item) =>
          item.id === link.id
            ? {
                ...item,
                status: "in-progress" as const,
                completedAt: null,
                latestThreadId: link.threadId,
                latestThreadEnvironmentId: undefined,
                threadLinks: [
                  { threadId: link.threadId },
                  ...(
                    item.threadLinks ??
                    (item.latestThreadId === undefined ? [] : [{ threadId: item.latestThreadId }])
                  ).filter((previous) => previous.threadId !== link.threadId),
                ].slice(0, 10),
              }
            : item,
        );
      }
      const activePrompts = savedPrompts.filter((item) => item.deletedAt === undefined);
      if (activePrompts.length > 100)
        return invariant("Clear saved prompts before restoring more (100 maximum).");
      let trashSize = 0;
      let trashCount = 0;
      savedPrompts = savedPrompts.filter((item) => {
        if (item.deletedAt === undefined) return true;
        trashSize += item.text.length;
        return ++trashCount <= 100 && trashSize <= 200000;
      });
      if (
        action !== undefined &&
        activePrompts.reduce((size, item) => size + item.text.length, 0) > 200000
      ) {
        return invariant("Saved prompts exceed the project text limit. Delete some prompts first.");
      }
      if (command.workspaceRoot !== undefined) {
        const conflict = requireWorkspaceAvailable(command.workspaceRoot);
        if (conflict !== undefined) return Result.fail(conflict);
      }
      return Result.succeed({
        ...base,
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title === undefined ? {} : { title: command.title }),
          ...(command.workspaceRoot === undefined ? {} : { workspaceRoot: command.workspaceRoot }),
          ...(command.defaultModelSelection === undefined
            ? {}
            : { defaultModelSelection: command.defaultModelSelection }),
          ...(command.defaultThreadEnvMode === undefined
            ? {}
            : { defaultThreadEnvMode: command.defaultThreadEnvMode }),
          ...(command.autoPull === undefined ? {} : { autoPull: command.autoPull }),
          ...(command.faviconPath === undefined ? {} : { faviconPath: command.faviconPath }),
          ...(command.projectIcon === undefined ? {} : { projectIcon: command.projectIcon }),
          ...(command.scripts === undefined ? {} : { scripts: command.scripts }),
          ...(action === undefined && command.savedPromptThread === undefined
            ? {}
            : { savedPrompts }),
          // Repeating a pin or archive keeps the original time.
          ...(command.pinned === undefined
            ? {}
            : { pinnedAt: command.pinned ? (project.pinnedAt ?? occurredAt) : null }),
          ...(command.archived === undefined
            ? {}
            : { archivedAt: command.archived ? (project.archivedAt ?? occurredAt) : null }),
          updatedAt: occurredAt,
        },
      });
    }

    case "project.delete": {
      if (activeProject === undefined) return missingProject();
      // Thread children are deleted by ProjectService before this event commits.
      return Result.succeed({
        ...base,
        type: "project.deleted",
        payload: { projectId: command.projectId, deletedAt: occurredAt },
      });
    }
  }
}
