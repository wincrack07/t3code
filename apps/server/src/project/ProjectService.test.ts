import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { resolveAttachmentPath } from "../attachmentStore.ts";
import { scanTaskAttachmentCopies } from "./taskAttachmentCleanup.ts";
import { DEFAULT_MACHINE_CLEANUP_SETTINGS } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Queue from "effect/Queue";
import * as Tracer from "effect/Tracer";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  type Project,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import {
  orchestrationCommandDuration,
  orchestrationCommandsTotal,
} from "../observability/Metrics.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";

const layerWorkspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot.replace(/\/$/, "")),
  resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
    Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
});

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: (workspaceRoot) =>
      Effect.succeed({
        canonicalKey: `github.com/t3tools/${workspaceRoot.split("/").at(-1)}`,
        locator: {
          source: "git-remote" as const,
          remoteName: "origin",
          remoteUrl: `git@github.com:t3tools/${workspaceRoot.split("/").at(-1)}.git`,
        },
        rootPath: workspaceRoot,
      }),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    invalidate: () => Effect.void,
    resolvePath: (workspaceRoot) => Effect.succeed(`${workspaceRoot}/favicon.svg`),
  }),
);

class EnrichmentCompletions extends Context.Service<EnrichmentCompletions, Queue.Queue<void>>()(
  "t3/project/ProjectService.test/EnrichmentCompletions",
) {}

const layerEnrichmentCompletions = Layer.effectContext(
  Effect.gen(function* () {
    const completions = yield* Queue.unbounded<void>();
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (...args) => {
          end(...args);
          if (
            span.name === "ProjectEnrichmentService.resolveRepositoryIdentity" ||
            span.name === "ProjectEnrichmentService.resolveFavicon"
          ) {
            Queue.offerUnsafe(completions, undefined);
          }
        };
        return span;
      },
    });
    return Context.make(EnrichmentCompletions, completions).pipe(
      Context.add(Tracer.Tracer, tracer),
    );
  }),
);

const layerTestFor = (
  projectMetadataLayer: Layer.Layer<
    | ProjectFaviconResolver.ProjectFaviconResolver
    | RepositoryIdentityResolver.RepositoryIdentityResolver
  >,
) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(layerWorkspacePaths),
    Layer.provideMerge(projectMetadataLayer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-service-test-" })),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    Layer.provideMerge(layerEnrichmentCompletions),
  );

const layerTest = layerTestFor(layerMetadata);

it.effect("resolves only the requested active project page in creation order", () =>
  Effect.gen(function* () {
    const inspected = yield* Ref.make<ReadonlySet<string>>(new Set());
    const note = (workspaceRoot: string) =>
      Ref.update(inspected, (roots) => new Set([...roots, workspaceRoot]));
    const metadata = Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: (workspaceRoot) =>
          note(workspaceRoot).pipe(
            Effect.as({
              canonicalKey: `example.test${workspaceRoot}`,
              locator: {
                source: "git-remote" as const,
                remoteName: "origin",
                remoteUrl: `https://example.test${workspaceRoot}.git`,
              },
              rootPath: workspaceRoot,
            }),
          ),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: (workspaceRoot) => note(workspaceRoot).pipe(Effect.as(null)),
      }),
    );
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* ProjectService.ProjectService;
      const enrichment = yield* ProjectEnrichmentService.ProjectEnrichmentService;
      const changes = yield* enrichment.subscribeChanges;
      const rows = Arr.makeBy(6, (index) => ({
        project_id: `page:${index}`,
        title: `Project ${index}`,
        workspace_root: `/work/page-${index}`,
        scripts_json: "[]",
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
        deleted_at: index === 1 ? "2026-10-02T00:00:00.000Z" : null,
        auto_pull: 0,
      }));
      yield* sql`INSERT INTO projection_projects ${sql.insert(rows)}`;
      const first = yield* service.listPage({ cursor: 0, limit: 2 });
      assert.deepEqual(
        first.projects.map((project) => project.id),
        ["page:0", "page:2"],
      );
      assert.equal(first.nextCursor, 2);
      assert.deepEqual(
        first.projects.map((project) => project.repositoryIdentity?.canonicalKey),
        ["example.test/work/page-0", "example.test/work/page-2"],
      );
      // A sentinel queued after the page lets the enrichment workers finish
      // earlier requests before checking which workspaces were inspected.
      yield* enrichment.request("/work/page-sentinel");
      for (;;) {
        if ((yield* PubSub.take(changes)).workspaceRoot === "/work/page-sentinel") break;
      }
      assert.deepEqual(
        new Set(yield* Ref.get(inspected)),
        new Set(["/work/page-0", "/work/page-2", "/work/page-sentinel"]),
      );
      const second = yield* service.listPage({ cursor: first.nextCursor!, limit: 2 });
      assert.deepEqual(
        second.projects.map((project) => project.id),
        ["page:3", "page:4"],
      );
      assert.equal(second.nextCursor, 4);
      const last = yield* service.listPage({ cursor: second.nextCursor!, limit: 2 });
      assert.deepEqual(
        last.projects.map((project) => project.id),
        ["page:5"],
      );
      assert.isNull(last.nextCursor);
      assert.isFalse((yield* Ref.get(inspected)).has("/work/page-1"));
      assert.deepEqual(yield* service.listPage({ cursor: 99, limit: 2 }), {
        projects: [],
        nextCursor: null,
      });
    }).pipe(Effect.scoped, Effect.provide(layerTestFor(metadata)));
  }),
);

const layerProjectServiceDependencies = Layer.mergeAll(
  RuntimeLayer.layerEventSink,
  ProjectStore.layer,
  ProjectionStore.layer,
  IdAllocator.layer,
  ThreadCommandExecutor.layer,
).pipe(
  Layer.provideMerge(LegacyV1ThreadImporter.layer.pipe(Layer.provide(RuntimeLayer.layerEventSink))),
  Layer.provideMerge(ProjectEnrichmentService.layer),
  Layer.provideMerge(layerWorkspacePaths),
  Layer.provideMerge(layerMetadata),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-service-race-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const waitForProject = Effect.fn("ProjectServiceTest.waitForProject")(function* (
  service: ProjectService.ProjectService["Service"],
  projectId: ProjectId,
  predicate: (project: Project) => boolean,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const completions = yield* EnrichmentCompletions;
      for (;;) {
        const project = Option.getOrThrow(yield* service.getById(projectId));
        if (predicate(project)) return project;
        yield* Queue.take(completions);
      }
    }),
  );
});

it.layer(layerTest)("ProjectService", (it) => {
  it.effect("persists project prompt actions and isolates projects", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("saved-prompts");
      const otherId = ProjectId.make("saved-prompts-other");
      for (const id of [projectId, otherId]) {
        yield* service.create({
          commandId: CommandId.make(`create:${id}`),
          projectId: id,
          title: "Demo",
          workspaceRoot: `/work/${id}`,
        });
      }
      const add = {
        commandId: CommandId.make("saved:add:1"),
        projectId,
        savedPrompt: { kind: "add", id: "one", text: "First prompt" },
      } as const;
      yield* service.update(add);
      yield* service.update(add);
      const second = yield* service.update({
        commandId: CommandId.make("saved:add:2"),
        projectId,
        savedPrompt: { kind: "add", id: "two", text: "Second prompt" },
      });
      assert.deepStrictEqual(
        second.savedPrompts?.map((item) => item.id),
        ["two", "one"],
      );
      assert.deepStrictEqual(Option.getOrThrow(yield* service.getById(otherId)).savedPrompts, []);
      yield* service.update({
        commandId: CommandId.make("saved:edit"),
        projectId,
        savedPrompt: { kind: "edit", id: "one", text: "Edited prompt" },
      });
      const titled = yield* service.update({
        commandId: CommandId.make("saved:title"),
        projectId,
        savedPrompt: { kind: "edit", id: "one", title: "Fix login", status: "in-progress" },
      });
      assert.strictEqual(
        titled.savedPrompts?.find((item) => item.id === "one")?.status,
        "in-progress",
      );
      assert.strictEqual(
        titled.savedPrompts?.find((item) => item.id === "one")?.text,
        "Edited prompt",
      );
      const linked = yield* service.update({
        commandId: CommandId.make("saved:link"),
        projectId,
        savedPromptThread: { id: "one", threadId: ThreadId.make("task-thread") },
      });
      assert.strictEqual(
        linked.savedPrompts?.find((item) => item.id === "one")?.latestThreadId,
        "task-thread",
      );
      const remote = yield* service.update({
        commandId: CommandId.make("saved:remote"),
        projectId,
        savedPrompt: {
          kind: "link",
          id: "one",
          threadId: ThreadId.make("remote-thread"),
          environmentId: EnvironmentId.make("remote"),
        },
      });
      assert.deepStrictEqual(remote.savedPrompts?.find((item) => item.id === "one")?.threadLinks, [
        { threadId: ThreadId.make("remote-thread"), environmentId: EnvironmentId.make("remote") },
        { threadId: ThreadId.make("task-thread") },
      ]);
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      yield* fs.makeDirectory(path.join(process.cwd(), ".t3"), { recursive: true });
      const fixture = yield* fs.makeTempDirectoryScoped({
        directory: path.join(process.cwd(), ".t3"),
        prefix: "task-reference-",
      });
      const reference = path.join(fixture, "reference.txt");
      yield* fs.writeFileString(reference, "Reference");
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "task-temporary-" });
      const temporaryFile = path.join(temporary, "body.txt");
      yield* fs.writeFileString(temporaryFile, "Stored body");
      const attach = {
        commandId: CommandId.make("saved:attach"),
        projectId,
        savedPrompt: {
          kind: "attach" as const,
          id: "one",
          attachments: [
            { kind: "path" as const, path: reference },
            { kind: "path" as const, path: temporaryFile },
            { kind: "path" as const, path: temporary },
            {
              kind: "upload" as const,
              attachment: {
                type: "image" as const,
                name: "screen.png",
                mimeType: "image/png",
                sizeBytes: 5,
                dataUrl: "data:image/png;base64,aW1hZ2U=",
              },
            },
          ],
        },
      };
      const attached = yield* service.update(attach);
      const details = (yield* service.taskAttachments({ projectId, taskId: "one" })).attachments;
      assert.strictEqual(details.length, 4);
      assert.deepStrictEqual(details[0]?.attachment, {
        kind: "reference",
        path: reference,
        temporary: false,
        sizeBytes: 9,
        isDirectory: false,
      });
      assert.deepStrictEqual(details[2]?.attachment, {
        kind: "reference",
        path: temporary,
        temporary: true,
        sizeBytes: 0,
        isDirectory: true,
      });
      const copied = details[1]?.attachment;
      assert.isTrue(copied?.kind === "stored");
      if (copied?.kind !== "stored") return assert.fail("expected a stored copy");
      yield* fs.remove(temporaryFile);
      assert.strictEqual(
        yield* fs.readFileString(
          resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment: copied.attachment,
          })!,
        ),
        "Stored body",
      );
      assert.deepStrictEqual((yield* service.update(attach)).savedPrompts, attached.savedPrompts);
      const absent = yield* service
        .update({
          ...attach,
          commandId: CommandId.make("saved:missing-file"),
          savedPrompt: {
            kind: "attach",
            id: "one",
            attachments: [{ kind: "path", path: temporaryFile }],
          },
        })
        .pipe(Effect.flip);
      assert.strictEqual(absent._tag, "TaskAttachmentError");
      if (absent._tag === "TaskAttachmentError")
        assert.strictEqual(absent.reason, "source-missing");
      assert.strictEqual(
        (yield* service.taskAttachments({ projectId, taskId: "one" })).attachments.length,
        4,
      );
      yield* fs.remove(reference);
      assert.strictEqual(
        (yield* service.taskAttachments({ projectId, taskId: "one" })).attachments[0]?.missing,
        true,
      );
      const usage = yield* Effect.promise(() =>
        scanTaskAttachmentCopies(
          config,
          [{ title: "Demo", deletedAt: null, savedPrompts: attached.savedPrompts }],
          DEFAULT_MACHINE_CLEANUP_SETTINGS,
        ),
      );
      assert.deepStrictEqual(usage.usage.open, { count: 2, bytes: 16 });
      const oversized = path.join(temporary, "oversized.bin");
      yield* fs.writeFileString(oversized, "x");
      yield* fs.truncate(oversized, 50 * 1024 * 1024 + 1);
      const tooBig = yield* service
        .update({
          ...attach,
          commandId: CommandId.make("saved:too-big"),
          savedPrompt: {
            kind: "attach",
            id: "one",
            attachments: [{ kind: "path", path: oversized }],
          },
        })
        .pipe(Effect.flip);
      assert.strictEqual(tooBig._tag, "TaskAttachmentError");
      if (tooBig._tag === "TaskAttachmentError") assert.strictEqual(tooBig.reason, "limit");
      const morePaths = Array.from({ length: 5 }, (_, index) =>
        path.join(fixture, `folder-${index}`),
      );
      yield* Effect.forEach(morePaths, (path) => fs.makeDirectory(path));
      const tooMany = yield* service
        .update({
          ...attach,
          commandId: CommandId.make("saved:too-many"),
          savedPrompt: {
            kind: "attach",
            id: "one",
            attachments: morePaths.map((path) => ({ kind: "path" as const, path })),
          },
        })
        .pipe(Effect.flip);
      assert.strictEqual(tooMany._tag, "ProjectInvalidError");
      yield* service.update({
        ...attach,
        commandId: CommandId.make("saved:remove-image"),
        savedPrompt: { kind: "remove-attachment", id: "one", key: details[3]!.key },
      });
      assert.strictEqual(
        (yield* service.taskAttachments({ projectId, taskId: "one" })).attachments.length,
        3,
      );
      const complete = yield* service.update({
        commandId: CommandId.make("saved:complete"),
        projectId,
        savedPrompt: { kind: "complete", id: "one", done: true },
      });
      assert.isNotNull(complete.savedPrompts?.find((item) => item.id === "one")?.completedAt);
      assert.strictEqual(complete.savedPrompts?.find((item) => item.id === "one")?.status, "done");
      yield* service.update({
        commandId: CommandId.make("saved:soft-delete"),
        projectId,
        savedPrompt: { kind: "delete", id: "one" },
      });
      const restored = yield* service.update({
        commandId: CommandId.make("saved:restore"),
        projectId,
        savedPrompt: { kind: "restore", id: "one" },
      });
      assert.deepStrictEqual(
        restored.savedPrompts?.find((item) => item.id === "one"),
        complete.savedPrompts?.find((item) => item.id === "one"),
      );
      const reopened = yield* service.update({
        commandId: CommandId.make("saved:reopen"),
        projectId,
        savedPrompt: { kind: "complete", id: "one", done: false },
      });
      assert.isNull(reopened.savedPrompts?.find((item) => item.id === "one")?.completedAt);
      assert.strictEqual(reopened.savedPrompts?.find((item) => item.id === "one")?.status, "open");
      assert.strictEqual(
        reopened.savedPrompts?.find((item) => item.id === "one")?.title,
        "Fix login",
      );
      const restartedStore = yield* ProjectStore.make;
      const stored = Option.getOrThrow(yield* restartedStore.get(projectId));
      assert.deepStrictEqual(stored.savedPrompts, reopened.savedPrompts);
      assert.strictEqual(
        stored.savedPrompts?.find((item) => item.id === "one")?.text,
        "Edited prompt",
      );
      assert.deepStrictEqual(
        Option.getOrThrow(yield* restartedStore.getShell(projectId)).savedPrompts,
        stored.savedPrompts,
      );
      yield* service.update({
        commandId: CommandId.make("saved:delete"),
        projectId,
        savedPrompt: { kind: "delete", id: "two" },
      });
      const legacyUndo = yield* service.update({
        commandId: CommandId.make("saved:legacy-undo"),
        projectId,
        savedPrompt: {
          kind: "add",
          id: "two",
          text: "Caller timestamps and text are not authoritative",
        },
      });
      assert.deepStrictEqual(
        legacyUndo.savedPrompts?.find((item) => item.id === "two"),
        second.savedPrompts?.find((item) => item.id === "two"),
      );
      yield* service.update({
        commandId: CommandId.make("saved:delete-again"),
        projectId,
        savedPrompt: { kind: "delete", id: "two" },
      });
      const missing = yield* service
        .update({
          commandId: CommandId.make("saved:missing"),
          projectId: otherId,
          savedPrompt: { kind: "edit", id: "one", text: "Wrong project" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(missing._tag, "ProjectInvalidError");
      yield* service.update({
        commandId: CommandId.make("saved:finish"),
        projectId,
        savedPrompt: { kind: "complete", id: "one", done: true },
      });
      const cleared = yield* service.update({
        commandId: CommandId.make("saved:clear"),
        projectId,
        savedPrompt: { kind: "clear-done" },
      });
      assert.deepStrictEqual(cleared.savedPrompts, []);
      const released = yield* Effect.promise(() =>
        scanTaskAttachmentCopies(
          config,
          [{ title: "Demo", deletedAt: null, savedPrompts: cleared.savedPrompts }],
          DEFAULT_MACHINE_CLEANUP_SETTINGS,
        ),
      );
      assert.deepStrictEqual(released.usage.orphaned, { count: 2, bytes: 16 });

      for (const id of [projectId, otherId]) {
        yield* service.delete({ commandId: CommandId.make(`cleanup:${id}`), projectId: id });
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("creates, updates, resolves, snapshots, and soft-deletes projects", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("project:service-test");
      const modelSelection = {
        instanceId: ProviderInstanceId.make("codex_custom"),
        model: "gpt-5.1-codex",
      } as const;
      yield* TestClock.setTime(Date.parse("2026-06-20T10:00:00.000Z"));

      const created = yield* service.create({
        commandId: CommandId.make("command:project:create"),
        projectId,
        title: "Project",
        workspaceRoot: "/work/project/",
        defaultModelSelection: modelSelection,
        scripts: [
          {
            id: "setup",
            name: "Setup",
            command: "vp install",
            icon: "configure",
            runOnWorktreeCreate: true,
          },
        ],
      });
      assert.equal(created.workspaceRoot, "/work/project");
      assert.isNull(created.repositoryIdentity);
      assert.isNull(created.faviconPath);

      const hydratedCreated = yield* waitForProject(
        service,
        projectId,
        (project) => project.repositoryIdentity !== null && project.faviconPath !== null,
      );
      assert.equal(hydratedCreated?.repositoryIdentity?.canonicalKey, "github.com/t3tools/project");
      assert.equal(hydratedCreated?.faviconPath, "/work/project/favicon.svg");

      const updated = yield* service.update({
        commandId: CommandId.make("command:project:update"),
        projectId,
        title: "Renamed",
        autoPull: true,
        projectIcon: { kind: "emoji", emoji: "🦊" },
        faviconPath: "/work/project/custom.svg",
        defaultThreadEnvMode: "worktree",
      });
      assert.equal(updated.title, "Renamed");
      assert.equal(updated.createdAt, created.createdAt);
      assert.isTrue(updated.autoPull);
      assert.deepEqual(updated.projectIcon, { kind: "emoji", emoji: "🦊" });
      assert.equal(updated.faviconPath, "/work/project/custom.svg");
      assert.equal(updated.defaultThreadEnvMode, "worktree");

      const byId = yield* service.getById(projectId);
      const byWorkspace = yield* service.getByWorkspaceRoot("/work/project/");
      assert.isTrue(Option.isSome(byId));
      assert.isTrue(Option.isSome(byWorkspace));
      assert.equal(Option.getOrThrow(byWorkspace).id, projectId);
      assert.isTrue(Option.getOrThrow(byId).autoPull);
      assert.deepEqual(Option.getOrThrow(byId).projectIcon, updated.projectIcon);
      assert.equal(Option.getOrThrow(byId).faviconPath, updated.faviconPath);
      assert.equal(Option.getOrThrow(byId).defaultThreadEnvMode, "worktree");
      const reset = yield* service.update({
        commandId: CommandId.make("command:project:reset-appearance"),
        projectId,
        autoPull: false,
        projectIcon: null,
        faviconPath: null,
        defaultThreadEnvMode: null,
      });
      assert.isFalse(reset.autoPull);
      assert.isNull(reset.projectIcon);
      assert.equal(
        (yield* waitForProject(
          service,
          projectId,
          (project) => project.faviconPath === hydratedCreated.faviconPath,
        )).faviconPath,
        hydratedCreated.faviconPath,
      );
      assert.isNull(reset.defaultThreadEnvMode);
      assert.deepEqual(
        (yield* service.snapshot).projects.map((project) => project.id),
        [projectId],
      );

      const deleted = yield* service.delete({
        commandId: CommandId.make("command:project:delete"),
        projectId,
      });
      assert.isNotNull(deleted.deletedAt);
      assert.isTrue(Option.isNone(yield* service.getById(projectId)));
      assert.isTrue(Option.isSome(yield* service.getById(projectId, { includeDeleted: true })));
      assert.deepEqual((yield* service.snapshot).projects, []);

      const sql = yield* SqlClient.SqlClient;
      const changes = yield* sql<{ readonly event_type: string }>`
        SELECT event_type
        FROM orchestration_events
        WHERE aggregate_kind = 'project' AND stream_id = ${projectId}
        ORDER BY sequence ASC
      `;
      assert.deepEqual(
        changes.map((change) => change.event_type),
        ["project.created", "project.meta-updated", "project.meta-updated", "project.deleted"],
      );
    }),
  );

  it.effect("records the outcome and duration of a committed project command", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const successes = Metric.value(
        Metric.withAttributes(orchestrationCommandsTotal, {
          commandType: "project.create",
          outcome: "success",
        }),
      );
      const durations = Metric.value(
        Metric.withAttributes(orchestrationCommandDuration, { commandType: "project.create" }),
      );
      const successesBefore = (yield* successes).count;
      const durationsBefore = (yield* durations).count;

      yield* service.create({
        commandId: CommandId.make("command:metrics:create"),
        projectId: ProjectId.make("project:metrics"),
        title: "Metrics",
        workspaceRoot: "/work/metrics",
      });

      assert.strictEqual((yield* successes).count - successesBefore, 1);
      assert.strictEqual((yield* durations).count - durationsBefore, 1);
    }),
  );

  it.effect("auto-bootstraps a workspace exactly once", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      yield* TestClock.setTime(Date.parse("2026-06-20T10:00:00.000Z"));
      const input = {
        commandId: CommandId.make("command:bootstrap:first"),
        projectId: ProjectId.make("project:bootstrap"),
        title: "Bootstrap",
        workspaceRoot: "/work/bootstrap/",
      };
      const first = yield* service.bootstrap(input);
      const second = yield* service.bootstrap({
        ...input,
        commandId: CommandId.make("command:bootstrap:second"),
        projectId: ProjectId.make("project:bootstrap:unused"),
      });
      assert.isTrue(first.created);
      assert.isFalse(second.created);
      assert.equal(second.project.id, first.project.id);
    }),
  );

  it.effect("commits the event, the row and the receipt together, once per command id", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:retry");
      const input = {
        commandId: CommandId.make("command:retry:create"),
        projectId,
        title: "Retry",
        workspaceRoot: "/work/retry",
      };
      const first = yield* service.create(input);
      const retried = yield* service.create(input);
      assert.deepEqual(retried, first);
      const updateInput = {
        commandId: CommandId.make("command:retry:update"),
        projectId,
        autoPull: true,
      };
      yield* service.update(updateInput);
      yield* service.update(updateInput);

      const committed = yield* sql<{
        readonly sequence: number;
        readonly event_type: string;
        readonly receipt_sequence: number;
        readonly status: string;
        readonly aggregate_kind: string;
      }>`
        SELECT events.sequence, events.event_type,
          receipts.result_sequence AS receipt_sequence, receipts.status, receipts.aggregate_kind
        FROM orchestration_events AS events
        JOIN orchestration_command_receipts AS receipts ON receipts.command_id = events.command_id
        WHERE events.stream_id = ${projectId}
        ORDER BY events.sequence
      `;
      assert.deepEqual(
        committed.map((row) => [row.event_type, row.status, row.aggregate_kind]),
        [
          ["project.created", "accepted", "project"],
          ["project.meta-updated", "accepted", "project"],
        ],
      );
      for (const row of committed) assert.equal(row.receipt_sequence, row.sequence);
      assert.isTrue(Option.getOrThrow(yield* service.getById(projectId)).autoPull);
    }),
  );

  it.effect("replays a rejected receipt instead of re-planning the command", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:rejected");
      yield* service.create({
        commandId: CommandId.make("command:rejected:create"),
        projectId,
        title: "Rejected",
        workspaceRoot: "/work/rejected",
      });
      const invalid = {
        commandId: CommandId.make("command:rejected:script"),
        projectId,
        scripts: [
          {
            id: "Not.Valid",
            name: "Invalid",
            command: "true",
            icon: "play" as const,
            runOnWorktreeCreate: false,
          },
        ],
      };
      const first = yield* service.update(invalid).pipe(Effect.flip);
      assert.equal(first._tag, "ProjectInvalidError");
      assert.include(first.message, "Script IDs must be 1-24 lowercase letters");
      const replayed = yield* service
        .update({ ...invalid, scripts: [{ ...invalid.scripts[0]!, id: "valid" }] })
        .pipe(Effect.flip);
      assert.deepEqual(replayed, first);
      const receipts = yield* sql<{ readonly status: string; readonly aggregate_id: string }>`
        SELECT status, aggregate_id FROM orchestration_command_receipts
        WHERE command_id = ${invalid.commandId}
      `;
      assert.deepEqual(receipts, [{ status: "rejected", aggregate_id: projectId }]);
      const events = yield* sql`
        SELECT sequence FROM orchestration_events WHERE command_id = ${invalid.commandId}
      `;
      assert.deepEqual(events, []);
      assert.deepEqual(Option.getOrThrow(yield* service.getById(projectId)).scripts, []);
    }),
  );

  it.effect("rejects a workspace another active project holds", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const other = ProjectId.make("project:conflict:mover");
      yield* service.create({
        commandId: CommandId.make("command:conflict:holder"),
        projectId: ProjectId.make("project:conflict:holder"),
        title: "Holder",
        workspaceRoot: "/work/conflict",
      });
      yield* service.create({
        commandId: CommandId.make("command:conflict:mover"),
        projectId: other,
        title: "Mover",
        workspaceRoot: "/work/conflict-mover",
      });
      const move = yield* service
        .update({
          commandId: CommandId.make("command:conflict:move"),
          projectId: other,
          workspaceRoot: "/work/conflict",
        })
        .pipe(Effect.flip);
      assert.equal(move._tag, "ProjectConflictError");
      assert.equal(
        Option.getOrThrow(yield* service.getById(other)).workspaceRoot,
        "/work/conflict-mover",
      );
    }),
  );

  it.effect("replays a workspace conflict after the workspace frees up", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const holderId = ProjectId.make("project:freed:holder");
      yield* service.create({
        commandId: CommandId.make("command:freed:holder"),
        projectId: holderId,
        title: "Holder",
        workspaceRoot: "/work/freed",
      });
      const claim = {
        commandId: CommandId.make("command:freed:claim"),
        projectId: ProjectId.make("project:freed:claim"),
        title: "Claim",
        workspaceRoot: "/work/freed",
      };
      const first = yield* service.create(claim).pipe(Effect.flip);
      yield* service.delete({
        commandId: CommandId.make("command:freed:delete"),
        projectId: holderId,
      });
      const replayed = yield* service.create(claim).pipe(Effect.flip);
      assert.deepEqual(replayed, first);
      assert.instanceOf(replayed, ProjectService.ProjectConflictError);
      assert.isTrue(
        Option.isNone(yield* service.getById(claim.projectId, { includeDeleted: true })),
      );
    }),
  );

  it.effect("returns the deleted project when a completed delete is retried", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:delete-retry");
      yield* service.create({
        commandId: CommandId.make("command:delete-retry:create"),
        projectId,
        title: "Delete retry",
        workspaceRoot: "/work/delete-retry",
      });
      // Enrichment landing between the two deletes would change the project the retry reads.
      yield* waitForProject(
        service,
        projectId,
        (project) => project.faviconPath !== null && project.repositoryIdentity !== null,
      );
      const input = { commandId: CommandId.make("command:delete-retry:delete"), projectId };
      const deleted = yield* service.delete(input);
      assert.deepEqual(yield* service.delete(input), deleted);
      const events = yield* sql<{ readonly command_id: string }>`
        SELECT command_id FROM orchestration_events
        WHERE stream_id = ${projectId} AND event_type = 'project.deleted'
      `;
      assert.deepEqual(events, [{ command_id: input.commandId }]);
    }),
  );

  it.effect("treats a deleted project as missing for updates and new deletes", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:deleted-target");
      yield* service.create({
        commandId: CommandId.make("command:deleted-target:create"),
        projectId,
        title: "Deleted target",
        workspaceRoot: "/work/deleted-target",
      });
      yield* service.delete({
        commandId: CommandId.make("command:deleted-target:delete"),
        projectId,
      });
      const again = yield* service
        .delete({ commandId: CommandId.make("command:deleted-target:delete-again"), projectId })
        .pipe(Effect.flip);
      assert.instanceOf(again, ProjectService.ProjectNotFoundError);
      const events = yield* sql<{ readonly event_type: string }>`
        SELECT event_type FROM orchestration_events
        WHERE stream_id = ${projectId} ORDER BY sequence ASC
      `;
      assert.deepEqual(
        events.map((event) => event.event_type),
        ["project.created", "project.deleted"],
      );
    }),
  );

  it.effect("rolls back the event and receipt when the row write fails", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:atomic");
      yield* sql`
        CREATE TRIGGER fail_project_row BEFORE INSERT ON projection_projects
        WHEN NEW.project_id = 'project:atomic'
        BEGIN SELECT RAISE(ABORT, 'injected row failure'); END
      `;
      const input = {
        commandId: CommandId.make("command:atomic:create"),
        projectId,
        title: "Atomic",
        workspaceRoot: "/work/atomic",
      };
      const failure = yield* service.create(input).pipe(Effect.flip);
      assert.equal(failure._tag, "ProjectOperationError");
      const leftovers = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_events WHERE command_id = ${input.commandId}) +
          (SELECT COUNT(*) FROM orchestration_command_receipts WHERE command_id = ${input.commandId}) +
          (SELECT COUNT(*) FROM projection_projects WHERE project_id = ${projectId}) AS count
      `;
      assert.equal(leftovers[0]?.count, 0);
      yield* sql`DROP TRIGGER fail_project_row`;
      assert.equal((yield* service.create(input)).id, projectId);
    }),
  );
});

it.effect("keeps project snapshots available when optional metadata enrichment fails", () =>
  Effect.gen(function* () {
    const layerFailingMetadata = Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: (workspaceRoot) =>
          Effect.fail(
            new ProjectFaviconResolver.ProjectFaviconResolutionError({
              operation: "stat-candidate",
              workspaceRoot,
              cause: "permission denied",
            }),
          ),
      }),
    );

    yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("project:failed-enrichment");
      yield* service.create({
        commandId: CommandId.make("command:failed-enrichment:create"),
        projectId,
        title: "Still visible",
        workspaceRoot: "/work/failed-enrichment",
      });

      const snapshot = yield* service.snapshot;
      assert.equal(snapshot.projects.length, 1);
      assert.equal(snapshot.projects[0]?.id, projectId);
      assert.equal(snapshot.projects[0]?.title, "Still visible");
      assert.isNull(snapshot.projects[0]?.repositoryIdentity ?? null);
      assert.isNull(snapshot.projects[0]?.faviconPath ?? null);
    }).pipe(Effect.provide(layerTestFor(layerFailingMetadata)));
  }),
);

it.effect("invalidates workspace-derived metadata when a project moves", () =>
  Effect.gen(function* () {
    const metadataVersion = yield* Ref.make(1);
    const layerVersionedMetadata = Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: (workspaceRoot) =>
          Ref.get(metadataVersion).pipe(
            Effect.map((version) => ({
              canonicalKey: `example.test/v${version}${workspaceRoot}`,
              locator: {
                source: "git-remote" as const,
                remoteName: "origin",
                remoteUrl: `https://example.test/v${version}${workspaceRoot}.git`,
              },
              rootPath: workspaceRoot,
            })),
          ),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: (workspaceRoot) =>
          Ref.get(metadataVersion).pipe(
            Effect.map((version) => `${workspaceRoot}/favicon-v${version}.svg`),
          ),
      }),
    );

    yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("project:moved-enrichment");
      yield* service.create({
        commandId: CommandId.make("command:moved-enrichment:create"),
        projectId,
        title: "Moved",
        workspaceRoot: "/work/original",
      });
      assert.equal(
        (yield* waitForProject(
          service,
          projectId,
          (project) => project.faviconPath === "/work/original/favicon-v1.svg",
        )).faviconPath,
        "/work/original/favicon-v1.svg",
      );

      yield* Ref.set(metadataVersion, 2);
      yield* service.update({
        commandId: CommandId.make("command:moved-enrichment:away"),
        projectId,
        workspaceRoot: "/work/temporary",
      });
      yield* service.snapshot;

      yield* Ref.set(metadataVersion, 3);
      yield* service.update({
        commandId: CommandId.make("command:moved-enrichment:return"),
        projectId,
        workspaceRoot: "/work/original",
      });
      assert.equal(
        (yield* waitForProject(
          service,
          projectId,
          (project) => project.faviconPath === "/work/original/favicon-v3.svg",
        )).faviconPath,
        "/work/original/favicon-v3.svg",
      );
    }).pipe(Effect.provide(layerTestFor(layerVersionedMetadata)));
  }),
);

it.effect("resolves a restored icon immediately after reselecting its saved path", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "project-icon-reselect-" });
    const iconPath = `${cwd}/icon.svg`;
    const metadata = Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      ProjectFaviconResolver.layer.pipe(
        Layer.provide(layerWorkspacePaths),
        Layer.provide(T3ProjectFileLoader.layer),
        Layer.provide(NodeServices.layer),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
      const projectId = ProjectId.make("project:icon-reselect");
      yield* service.create({
        commandId: CommandId.make("command:icon-reselect:create"),
        projectId,
        title: "Icon reselection",
        workspaceRoot: cwd,
      });
      yield* service.update({
        commandId: CommandId.make("command:icon-reselect:missing"),
        projectId,
        faviconPath: "icon.svg",
      });
      assert.isNull(yield* resolver.resolvePath(cwd, "icon.svg"));
      yield* fileSystem.writeFileString(iconPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
      assert.isNull(yield* resolver.resolvePath(cwd, "icon.svg"));
      yield* service.update({
        commandId: CommandId.make("command:icon-reselect:restored"),
        projectId,
        faviconPath: "icon.svg",
      });
      assert.equal(yield* resolver.resolvePath(cwd, "icon.svg"), iconPath);
    }).pipe(Effect.provide(layerTestFor(metadata)));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses a worktree container as a new project and as a new workspace root", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: "project-container-" });
    const git = (cwd: string, ...args: ReadonlyArray<string>) =>
      processRunner.run({
        command: "git",
        args: ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args],
      });
    const source = `${fixture}/source`;
    const container = `${fixture}/container`;
    yield* fileSystem.makeDirectory(source);
    yield* fileSystem.makeDirectory(container);
    yield* git(source, "init", "-b", "develop");
    yield* fileSystem.writeFileString(`${source}/README.md`, "readme\n");
    yield* git(source, "add", "README.md");
    yield* git(source, "commit", "-m", "init");
    yield* git(fixture, "clone", "--bare", source, `${container}/.bare`);
    yield* fileSystem.writeFileString(`${container}/.git`, "gitdir: ./.bare\n");
    yield* git(container, "worktree", "add", "develop", "develop");

    yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      // As cloned the container is bare; Initialize Git or a config edit clears core.bare.
      for (const coreBare of ["true", "false"]) {
        yield* git(container, "config", "core.bare", coreBare);
        const rejected = yield* service
          .create({
            commandId: CommandId.make(`command:container:create:${coreBare}`),
            projectId: ProjectId.make(`project:container:${coreBare}`),
            title: "Container",
            workspaceRoot: container,
          })
          .pipe(Effect.flip);
        assert.equal(rejected._tag, "ProjectInvalidError", `core.bare=${coreBare}`);
        assert.include(rejected.message, "Add one of its worktrees");
        assert.isTrue(Option.isNone(yield* service.getByWorkspaceRoot(container)));
      }

      const projectId = ProjectId.make("project:container:worktree");
      const worktree = yield* service.create({
        commandId: CommandId.make("command:container:worktree"),
        projectId,
        title: "Worktree",
        workspaceRoot: `${container}/develop`,
      });
      const moved = yield* service
        .update({
          commandId: CommandId.make("command:container:move"),
          projectId,
          workspaceRoot: container,
        })
        .pipe(Effect.flip);
      assert.equal(moved._tag, "ProjectInvalidError");
      assert.equal(
        Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot,
        worktree.workspaceRoot,
      );
    }).pipe(Effect.provide(layerTest));
  }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
);

it.effect("serializes two projects claiming the same workspace root", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const firstReachedCommit = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const gatedSink = EventSink.EventSinkV2.of({
      ...eventSink,
      commitProjectCommand: (input) =>
        input.projectId === "project:race:first"
          ? Deferred.succeed(firstReachedCommit, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirst)),
              Effect.andThen(eventSink.commitProjectCommand(input)),
            )
          : eventSink.commitProjectCommand(input),
    });
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(EventSink.EventSinkV2, gatedSink),
    );
    const claim = (name: string) =>
      service.create({
        commandId: CommandId.make(`command:race:${name}`),
        projectId: ProjectId.make(`project:race:${name}`),
        title: name,
        workspaceRoot: "/work/race",
      });
    const first = yield* claim("first").pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(firstReachedCommit);
    const second = yield* claim("second").pipe(
      Effect.flip,
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    assert.isUndefined(second.pollUnsafe());
    yield* Deferred.succeed(releaseFirst, undefined);
    assert.equal((yield* Fiber.join(first)).id, "project:race:first");
    assert.equal((yield* Fiber.join(second))._tag, "ProjectConflictError");
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);

it.effect("rejects an update that waited on the lock while its project was deleted", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const deleteReachedCommit = yield* Deferred.make<void>();
    const releaseDelete = yield* Deferred.make<void>();
    const gatedSink = EventSink.EventSinkV2.of({
      ...eventSink,
      commitProjectCommand: (input) =>
        input.commandType === "project.delete"
          ? Deferred.succeed(deleteReachedCommit, undefined).pipe(
              Effect.andThen(Deferred.await(releaseDelete)),
              Effect.andThen(eventSink.commitProjectCommand(input)),
            )
          : eventSink.commitProjectCommand(input),
    });
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(EventSink.EventSinkV2, gatedSink),
    );
    const sql = yield* SqlClient.SqlClient;
    const projectId = ProjectId.make("project:update-race");
    yield* service.create({
      commandId: CommandId.make("command:update-race:create"),
      projectId,
      title: "Update race",
      workspaceRoot: "/work/update-race",
    });
    const deletion = yield* service
      .delete({ commandId: CommandId.make("command:update-race:delete"), projectId })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(deleteReachedCommit);
    const updateCommandId = CommandId.make("command:update-race:update");
    const update = yield* service
      .update({ commandId: updateCommandId, projectId, title: "Too late" })
      .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    yield* Deferred.succeed(releaseDelete, undefined);
    assert.isNotNull((yield* Fiber.join(deletion)).deletedAt);
    assert.instanceOf(yield* Fiber.join(update), ProjectService.ProjectNotFoundError);
    const receipts = yield* sql<{ readonly status: string }>`
      SELECT status FROM orchestration_command_receipts WHERE command_id = ${updateCommandId}
    `;
    assert.deepEqual(receipts, [{ status: "rejected" }]);
    const events = yield* sql<{ readonly event_type: string }>`
      SELECT event_type FROM orchestration_events
      WHERE stream_id = ${projectId} ORDER BY sequence ASC
    `;
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["project.created", "project.deleted"],
    );
    assert.equal(
      Option.getOrThrow(yield* service.getById(projectId, { includeDeleted: true })).title,
      "Update race",
    );
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);
