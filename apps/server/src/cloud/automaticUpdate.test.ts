import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as SqlClient from "effect/sql/SqlClient";
import { activateIdleServerUpdate } from "./automaticUpdate.ts";

const setup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE orchestration_v2_projection_runs (status TEXT)`;
  yield* sql`CREATE TABLE orchestration_v2_effect_outbox (status TEXT)`;
  yield* sql`CREATE TABLE orchestration_v2_projection_provider_threads (status TEXT, payload_json TEXT)`;
  yield* sql`CREATE TABLE scheduled_tasks (enabled INTEGER, next_run_at TEXT)`;
  return sql;
});

it.effect.each(["preparing", "queued", "starting", "running", "waiting"])(
  "defers automatic handoff for a %s run",
  (status) =>
    Effect.gen(function* () {
      const sql = yield* setup;
      yield* sql`INSERT INTO orchestration_v2_projection_runs VALUES (${status})`;
      yield* activateIdleServerUpdate({
        currentVersion: "1.0.0",
        targetVersion: "1.0.1",
        activate: Effect.die("must stay running"),
      });
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect.each(["pending", "running"])("defers automatic handoff for %s outbox work", (status) =>
  Effect.gen(function* () {
    const sql = yield* setup;
    yield* sql`INSERT INTO orchestration_v2_effect_outbox VALUES (${status})`;
    yield* activateIdleServerUpdate({
      currentVersion: "1.0.0",
      targetVersion: "1.0.1",
      activate: Effect.die("must stay running"),
    });
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("never downgrades or reinstalls, even with an idle database", () =>
  Effect.gen(function* () {
    yield* setup;
    for (const targetVersion of ["1.0.0", "0.9.9", "1.0.0-nightly.20261111.9999"]) {
      yield* activateIdleServerUpdate({
        currentVersion: "1.0.0",
        targetVersion,
        activate: Effect.die("must stay running"),
      });
    }
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("holds command writes through handoff until shutdown", () =>
  Effect.gen(function* () {
    const sql = yield* setup;
    const accepted = yield* Deferred.make<void>();
    const handoff = yield* activateIdleServerUpdate({
      currentVersion: "1.0.0",
      targetVersion: "1.0.1",
      activate: Deferred.succeed(accepted, undefined).pipe(Effect.as("accepted")),
    }).pipe(Effect.forkScoped);
    yield* Deferred.await(accepted);
    const attempted = yield* Deferred.make<void>();
    const writer = yield* Deferred.succeed(attempted, undefined).pipe(
      Effect.andThen(sql`INSERT INTO orchestration_v2_projection_runs VALUES ('running')`),
      Effect.forkScoped,
    );
    yield* Deferred.await(attempted);
    assert.isUndefined(writer.pollUnsafe());
    yield* Fiber.interrupt(handoff);
    yield* Fiber.join(writer);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("waits for provider background work and due scheduled tasks", () =>
  Effect.gen(function* () {
    const sql = yield* setup;
    const activate = Effect.die("must stay running");
    yield* sql`INSERT INTO orchestration_v2_projection_provider_threads VALUES ('idle', '{"pendingBackgroundTasks":[{"taskId":"child"}]}')`;
    yield* activateIdleServerUpdate({ currentVersion: "1.0.0", targetVersion: "1.0.1", activate });
    yield* sql`DELETE FROM orchestration_v2_projection_provider_threads`;
    yield* sql`INSERT INTO scheduled_tasks VALUES (1, '1969-01-01T00:00:00.000Z')`;
    yield* activateIdleServerUpdate({ currentVersion: "1.0.0", targetVersion: "1.0.1", activate });
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
