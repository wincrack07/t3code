import * as NodeSqlite from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { runServicePreflight } from "../cloud/servicePreflight.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";
import {
  FORK_MIGRATIONS_TABLE,
  forkMigrationManifest,
  runAllMigrations,
} from "./ForkMigrations.ts";
import Fork0001 from "./ForkMigrations/001_ProjectSavedPrompts.ts";
import Fork0002 from "./ForkMigrations/002_SavedPromptTasks.ts";
import Fork0003 from "./ForkMigrations/003_ProjectTaskBatches.ts";
import Fork0004 from "./ForkMigrations/004_ChatHubSync.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";

const ledger = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
      SELECT migration_id, name FROM ${sql(table)} ORDER BY migration_id`;
    return rows.map((row) => [row.migration_id, row.name] as const);
  });

// What fork builds before the split did: fork migrations recorded under upstream ids 83-86.
const migrateLikeOldFork = Effect.gen(function* () {
  yield* runMigrations({ toMigrationInclusive: 82 });
  yield* Migrator.make({})({
    loader: Migrator.fromRecord({
      "83_ProjectSavedPrompts": Fork0001,
      "84_SavedPromptTasks": Fork0002,
      "85_ProjectTaskBatches": Fork0003,
      "86_ChatHubSync": Fork0004,
    }),
  });
});

const upstreamManifest = migrationManifest.map(([id, name]) => [id, name] as const);
const forkManifest = forkMigrationManifest.map(([id, name]) => [id, name] as const);
const memory = NodeSqliteClient.layer({ filename: ":memory:" });

describe("fork migrations", () => {
  it.effect("repairs an old fork database so upstream migrations run and upstream accepts it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* migrateLikeOldFork;
      const at = "2026-11-12T10:00:00.000Z";
      yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, saved_prompts_json, created_at, updated_at)
        VALUES ('demo', 'demo', '/work/demo', '[]', '[{"id":"kept"}]', ${at}, ${at})`;

      yield* runAllMigrations();

      assert.deepStrictEqual(yield* ledger("effect_sql_migrations"), upstreamManifest);
      assert.deepStrictEqual(yield* ledger(FORK_MIGRATIONS_TABLE), forkManifest);
      const [project] = yield* sql<{ readonly saved_prompts_json: string }>`
        SELECT saved_prompts_json FROM projection_projects WHERE project_id = 'demo'`;
      assert.strictEqual(project?.saved_prompts_json, '[{"id":"kept"}]');
      // An upstream build sees its own history and has nothing to do.
      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* runAllMigrations(), []);
    }).pipe(Effect.provide(memory)),
  );

  it.effect("builds a new database with both histories complete", () =>
    Effect.gen(function* () {
      yield* runAllMigrations();
      assert.deepStrictEqual(yield* ledger("effect_sql_migrations"), upstreamManifest);
      assert.deepStrictEqual(yield* ledger(FORK_MIGRATIONS_TABLE), forkManifest);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(memory)),
  );

  it.effect("upgrades saved prompts to tasks without changing their text or completion", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({ "1_ProjectSavedPrompts": Fork0001 }),
        table: FORK_MIGRATIONS_TABLE,
      });
      const at = "2026-06-20T10:00:00.000Z";
      const old = [
        { id: "open", text: "First line\nMore detail", createdAt: at, completedAt: null },
        { id: "done", text: "Already done", createdAt: at, completedAt: at },
      ];
      for (const [id, prompts] of [
        ["demo", old],
        ["empty", []],
      ] as const) {
        yield* sql`INSERT INTO projection_projects
          (project_id, title, workspace_root, scripts_json, saved_prompts_json, created_at, updated_at)
          VALUES (${id}, ${id}, ${`/work/${id}`}, '[]', ${JSON.stringify(prompts)}, ${at}, ${at})`;
      }
      yield* runAllMigrations();
      const rows = yield* sql<{ project_id: string; saved_prompts_json: string }>`
        SELECT project_id, saved_prompts_json FROM projection_projects ORDER BY project_id`;
      assert.deepStrictEqual(
        JSON.parse(rows[0]!.saved_prompts_json),
        old.map((item) => ({
          ...item,
          title: null,
          attachments: [],
          status: item.completedAt === null ? "open" : "done",
        })),
      );
      assert.deepStrictEqual(JSON.parse(rows[1]!.saved_prompts_json), []);
    }).pipe(Effect.provide(memory)),
  );
});

it.layer(NodeServices.layer)("fork migrations and update preflight", (it) => {
  it.effect("lets a server update from an old fork database", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const databasePath = path.join(
        yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-preflight-" }),
        "state.sqlite",
      );
      const db = new NodeSqlite.DatabaseSync(databasePath);
      db.exec("CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT)");
      const insert = db.prepare("INSERT INTO effect_sql_migrations VALUES (?, ?)");
      for (const [id, name] of migrationManifest.filter(([id]) => id <= 82)) insert.run(id, name);
      for (const [id, name] of forkMigrationManifest) insert.run(id + 82, name);
      db.close();

      const result = runServicePreflight({
        databasePath,
        launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
      });
      assert.strictEqual(result.status, "ready");
    }),
  );
});
