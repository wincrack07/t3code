import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { addColumnIfMissing } from "./schema.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* addColumnIfMissing(
    sql,
    "projection_projects",
    "saved_prompts_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
});
