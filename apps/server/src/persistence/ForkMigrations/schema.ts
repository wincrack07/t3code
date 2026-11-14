import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

// Fork columns live on upstream-owned tables; checking first lets a fork migration rerun safely.
export const addColumnIfMissing = Effect.fn("ForkMigrations.addColumnIfMissing")(function* (
  sql: SqlClient.SqlClient,
  table: string,
  column: string,
  definition: string,
) {
  const columns = yield* sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`;
  if (columns.some((row) => row.name === column)) return false;
  yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
});
