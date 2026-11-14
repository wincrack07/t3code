import { assert, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type T3ThreadExportResult } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import migration from "../persistence/ForkMigrations/004_ChatHubSync.ts";
import * as ChatHubSync from "./ChatHubSync.ts";

const setup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* migration;
  yield* sql`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT PRIMARY KEY,updated_at TEXT NOT NULL)`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES('chat','1970-01-01T00:00:00.000Z')`;
  let revision = "1970-01-01T00:00:00.000Z";
  const calls: string[] = [];
  const urls: string[] = [];
  let httpStatus = 200;
  let secret: Uint8Array | undefined;
  const exported = (): T3ThreadExportResult => ({
    bundle: {
      format: "t3code.thread",
      version: 1,
      threadId: ThreadId.make("chat"),
      title: "Example",
      createdAt: revision,
      updatedAt: revision,
      source: { environmentId: EnvironmentId.make("machine"), label: "Machine" },
      project: { title: "Project", workspacePath: "/work" },
      provider: "codex",
      model: "test",
      conversation: [],
    },
    meta: {
      environmentId: EnvironmentId.make("machine"),
      environmentLabel: "Machine",
      threadId: ThreadId.make("chat"),
      title: "Example",
      projectTitle: "Project",
      workspaceRoot: "/work",
      provider: null,
      model: null,
      createdAt: revision,
      updatedAt: revision,
      archived: false,
      deletedAt: null,
      messageCount: 0,
    },
  });
  const deps = Layer.mergeAll(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      exportThread: () => Effect.sync(exported),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({}),
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("machine")),
    }),
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: () => Effect.sync(() => Option.fromUndefinedOr(secret)),
      set: (_name, value) =>
        Effect.sync(() => {
          secret = value;
        }),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          urls.push(request.url);
          assert.equal(request.headers.authorization, "Bearer fake-test-token");
          if (request.method === "GET") {
            const body = request.url.includes("format=md")
              ? "# Example"
              : JSON.stringify(
                  request.url.includes("threads?")
                    ? { items: [exported().meta], nextCursor: null }
                    : exported(),
                );
            return HttpClientResponse.fromWeb(request, new Response(body));
          }
          calls.push(revision);
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ stored: false }), { status: httpStatus }),
          );
        }),
      ),
    ),
  );
  const build = Effect.service(ChatHubSync.ChatHubSync).pipe(
    Effect.provide(ChatHubSync.layer.pipe(Layer.provide(deps))),
  );
  const service = yield* build;
  yield* service.configure({ url: "https://hub.example", enabled: true, token: "fake-test-token" });
  return {
    sql,
    service,
    build,
    calls,
    urls,
    fail: () => {
      httpStatus = 503;
    },
    update: (value: string) => {
      revision = value;
      return sql`UPDATE orchestration_v2_projection_threads SET updated_at=${value}`;
    },
  };
});
it.effect(
  "debounces changes, accepts stored:false and retains its manifest across service restart",
  () =>
    Effect.gen(function* () {
      const { service, build, calls, update } = yield* setup;
      yield* service.sweep;
      assert.equal(calls.length, 0);
      yield* TestClock.adjust("9 seconds");
      yield* service.sweep;
      assert.equal(calls.length, 0);
      yield* update("1970-01-01T00:00:09.000Z");
      yield* TestClock.adjust("10 seconds");
      yield* service.sweep;
      assert.deepEqual(calls, ["1970-01-01T00:00:09.000Z"]);
      const restarted = yield* build;
      yield* restarted.sweep;
      assert.equal(calls.length, 1);
      assert.equal((yield* restarted.status).pendingCount, 0);
      yield* update("1970-01-01T00:00:19.000Z");
      yield* TestClock.adjust("10 seconds");
      yield* restarted.sweep;
      assert.equal(calls.length, 2);
      assert.equal((yield* restarted.status).pendingCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
it.effect("backs off, pauses after five failures, retries later and never exposes the secret", () =>
  Effect.gen(function* () {
    const { service, calls, fail, sql } = yield* setup;
    fail();
    assert.notInclude(JSON.stringify(yield* service.status), "fake-test-token");
    assert.notInclude(JSON.stringify(yield* sql`SELECT * FROM chat_hub_config`), "fake-test-token");
    yield* TestClock.adjust("10 seconds");
    yield* service.sweep;
    yield* service.sweep;
    assert.equal(calls.length, 1);
    for (const seconds of [20, 40, 80, 160]) {
      yield* TestClock.adjust(`${seconds} seconds`);
      yield* service.sweep;
    }
    assert.equal(calls.length, 5);
    yield* TestClock.adjust("14 minutes");
    yield* service.sweep;
    assert.equal(calls.length, 5);
    yield* TestClock.adjust("1 minute");
    yield* service.sweep;
    assert.equal(calls.length, 6);
    yield* service.syncNow;
    yield* service.sweep;
    assert.equal(calls.length, 7);
    const result = yield* service.configure({ url: "https://hub.example", enabled: false });
    assert.notInclude(JSON.stringify(result), "fake-test-token");
    yield* TestClock.adjust("1 hour");
    yield* service.sweep;
    assert.equal(calls.length, 7);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect(
  "proxies typed list and detail reads with encoded filters and no credential in responses",
  () =>
    Effect.gen(function* () {
      const { service, urls } = yield* setup;
      const list = yield* service.list({ q: "a&b", project: "Project / one" });
      assert.equal(list.items[0]?.title, "Example");
      const detail = yield* service.get({ environmentId: "machine:one", threadId: "chat%two" });
      assert.equal(detail.markdown, "# Example");
      assert.notInclude(JSON.stringify({ list, detail }), "fake-test-token");
      assert.include(urls[0]!, "q=a%26b");
      assert.include(urls[1]!, "machine%3Aone/chat%25two");
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
