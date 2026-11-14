import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS chat_hub_config (id INTEGER PRIMARY KEY CHECK(id=1), url TEXT NOT NULL, enabled INTEGER NOT NULL, last_success TEXT, last_error TEXT)`;
  yield* sql`INSERT OR IGNORE INTO chat_hub_config (id,url,enabled) VALUES (1,'',0)`;
  yield* sql`CREATE TABLE IF NOT EXISTS chat_hub_manifest (thread_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, pushed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0)`;
});
