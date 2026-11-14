import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { hasPendingMigrations, runMigrations, type RunMigrationsOptions } from "./Migrations.ts";

import Fork0001 from "./ForkMigrations/001_ProjectSavedPrompts.ts";
import Fork0002 from "./ForkMigrations/002_SavedPromptTasks.ts";
import Fork0003 from "./ForkMigrations/003_ProjectTaskBatches.ts";
import Fork0004 from "./ForkMigrations/004_ChatHubSync.ts";

// Upstream owns every id in effect_sql_migrations. The Migrator skips ids at or below the highest
// recorded, so a fork migration there would make upstream's next migration with that id never run.
// Fork-only schema is recorded in its own ledger; add new fork migrations here, never in Migrations.ts.
export const FORK_MIGRATIONS_TABLE = "t3_fork_migrations";

const forkMigrationEntries = [
  [1, "ProjectSavedPrompts", Fork0001],
  [2, "SavedPromptTasks", Fork0002],
  [3, "ProjectTaskBatches", Fork0003],
  [4, "ChatHubSync", Fork0004],
] as const;

export const forkMigrationManifest = forkMigrationEntries.map(([id, name]) => [id, name] as const);

// Fork builds before the split recorded fork migrations under these upstream ids.
const LEGACY_UPSTREAM_ROWS: ReadonlyArray<{
  readonly upstreamId: number;
  readonly forkId: number;
  readonly name: string;
}> = forkMigrationEntries.map(([forkId, name]) => ({ upstreamId: forkId + 82, forkId, name }));

const isLegacyForkRow = (row: { readonly id: number; readonly name: string }) =>
  LEGACY_UPSTREAM_ROWS.some((legacy) => legacy.upstreamId === row.id && legacy.name === row.name);

/** Upstream's history as startup leaves it once legacy fork rows move to the fork ledger. */
export const withoutLegacyForkRows = <Row extends { readonly id: number; readonly name: string }>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<Row> => rows.filter((row) => !isLegacyForkRow(row));

const run = Migrator.make({});

const tableExists = Effect.fn("ForkMigrations.tableExists")(function* (name: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`;
  return rows.length > 0;
});

const legacyRowsInUpstreamLedger = Effect.fn("ForkMigrations.legacyRows")(function* () {
  if (!(yield* tableExists("effect_sql_migrations"))) return [];
  const sql = yield* SqlClient.SqlClient;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  return LEGACY_UPSTREAM_ROWS.filter((legacy) =>
    recorded.some((row) => row.migration_id === legacy.upstreamId && row.name === legacy.name),
  );
});

/** Moves fork rows that older fork builds wrote into effect_sql_migrations to the fork ledger, so
 * upstream migrations with those ids run and an upstream build accepts the database. */
export const reclaimLegacyForkMigrations = Effect.fn("ForkMigrations.reclaimLegacy")(function* () {
  const legacy = yield* legacyRowsInUpstreamLedger();
  if (legacy.length === 0) return [];
  const sql = yield* SqlClient.SqlClient;
  // An empty loader only creates the ledger with the Migrator's own schema.
  yield* run({ loader: Migrator.fromRecord({}), table: FORK_MIGRATIONS_TABLE });
  yield* sql.withTransaction(
    Effect.forEach(
      legacy,
      ({ upstreamId, forkId, name }) =>
        Effect.gen(function* () {
          yield* sql`INSERT OR IGNORE INTO ${sql(FORK_MIGRATIONS_TABLE)} (migration_id, name) VALUES (${forkId}, ${name})`;
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${upstreamId} AND name = ${name}`;
        }),
      { discard: true },
    ),
  );
  yield* Effect.log("Moved fork migrations out of the upstream migration history").pipe(
    Effect.annotateLogs({ migrations: legacy.map(({ upstreamId, name }) => `${upstreamId}_${name}`) }),
  );
  return legacy.map(({ forkId, name }) => [forkId, name] as const);
});

export const hasPendingForkMigrations = Effect.fn("ForkMigrations.hasPending")(function* () {
  if ((yield* legacyRowsInUpstreamLedger()).length > 0) return true;
  if (yield* hasPendingMigrations()) return true;
  if (!(yield* tableExists(FORK_MIGRATIONS_TABLE))) return true;
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{
    readonly id: number | null;
  }>`SELECT MAX(migration_id) AS id FROM ${sql(FORK_MIGRATIONS_TABLE)}`;
  return (row?.id ?? 0) < Math.max(...forkMigrationEntries.map(([id]) => id));
});

/** Upstream migrations, then the fork's. A partial run (`toMigrationInclusive`) is an upstream test
 * concern and leaves the fork schema alone. */
export const runAllMigrations = Effect.fn("ForkMigrations.runAll")(function* (
  options: RunMigrationsOptions = {},
) {
  yield* reclaimLegacyForkMigrations();
  const upstream = yield* runMigrations(options);
  if (options.toMigrationInclusive !== undefined) return upstream;
  const fork = yield* run({
    loader: Migrator.fromRecord(
      Object.fromEntries(forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
    ),
    table: FORK_MIGRATIONS_TABLE,
  });
  if (fork.length > 0) {
    yield* Effect.log("Ran fork migrations").pipe(
      Effect.annotateLogs({ migrations: fork.map(([id, name]) => `${id}_${name}`) }),
    );
  }
  return upstream;
});
