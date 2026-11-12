import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_projects
    SET saved_prompts_json = (
      SELECT COALESCE(json_group_array(json_set(value,
        '$.title', NULL,
        '$.attachments', json('[]'),
        '$.status', CASE WHEN json_extract(value, '$.completedAt') IS NULL THEN 'open' ELSE 'done' END
      )), '[]')
      FROM json_each(projection_projects.saved_prompts_json)
    )
  `;
});
