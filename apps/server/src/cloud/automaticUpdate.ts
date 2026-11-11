import { ServerSelfUpdateError } from "@t3tools/contracts";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const isSelfUpdateError = Schema.is(ServerSelfUpdateError);

export const activateIdleServerUpdate = Effect.fn("ServerSelfUpdate.activateIdle")(
  function* (input: {
    readonly currentVersion: string;
    readonly targetVersion: string;
    readonly activate: Effect.Effect<string, ServerSelfUpdateError>;
  }) {
    if (compareSemverVersions(input.targetVersion, input.currentVersion) <= 0) return;
    const sql = yield* SqlClient.SqlClient;
    const now = DateTime.formatIso(yield* DateTime.now);
    // BEGIN IMMEDIATE holds the writer through handoff: no command or outbox claim can start work.
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ busy: number }>`
      SELECT EXISTS (
        SELECT 1 FROM orchestration_v2_projection_runs
        WHERE status IN ('preparing', 'queued', 'starting', 'running', 'waiting')
      ) OR EXISTS (
        SELECT 1 FROM orchestration_v2_effect_outbox WHERE status IN ('pending', 'running')
      ) OR EXISTS (
        SELECT 1 FROM orchestration_v2_projection_provider_threads
        WHERE status IN ('starting', 'running', 'waiting')
          OR json_array_length(payload_json, '$.pendingBackgroundTasks') > 0
      ) OR EXISTS (
        SELECT 1 FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ${now}
      ) AS busy
    `;
          if (rows[0]?.busy !== 0) return;
          yield* input.activate;
          // Release only on shutdown; an acknowledged launcher request is about to terminate this process.
          return yield* Effect.never;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isSelfUpdateError(cause)
            ? cause
            : new ServerSelfUpdateError({
                reason: "Could not reserve the idle server for an automatic update.",
                cause,
              }),
        ),
      );
  },
);
