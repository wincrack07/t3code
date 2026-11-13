import { ThreadId } from "@t3tools/contracts";
import {
  ChatHubSyncError,
  ChatHubStatus,
  ChatHubConfigure,
  ChatHubQuery,
  ChatHubLookup,
} from "@t3tools/contracts/chat-hub-sync";
import {
  ChatHubList,
  ChatHubThread,
  ChatHubEnvironments,
  ChatHubStored,
} from "@t3tools/contracts/chat-hub";
import { renderThreadExportMarkdown } from "@t3tools/shared/threadExport";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

type Status = typeof ChatHubStatus.Type;
type Config = {
  url: string;
  enabled: number;
  last_success: string | null;
  last_error: string | null;
};
export class ChatHubSync extends Context.Service<
  ChatHubSync,
  {
    readonly status: Effect.Effect<Status, ChatHubSyncError>;
    readonly configure: (
      input: typeof ChatHubConfigure.Type,
    ) => Effect.Effect<Status, ChatHubSyncError>;
    readonly syncNow: Effect.Effect<Status, ChatHubSyncError>;
    readonly sweep: Effect.Effect<void, ChatHubSyncError>;
    readonly list: (
      input: typeof ChatHubQuery.Type,
    ) => Effect.Effect<typeof ChatHubList.Type, ChatHubSyncError>;
    readonly get: (
      input: typeof ChatHubLookup.Type,
    ) => Effect.Effect<typeof ChatHubThread.Type & { markdown: string }, ChatHubSyncError>;
    readonly environments: Effect.Effect<typeof ChatHubEnvironments.Type, ChatHubSyncError>;
  }
>()("t3/chatHub/ChatHubSync") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const client = yield* HttpClient.HttpClient;
  const lock = yield* Semaphore.make(1);
  const failure = (operation: string) => new ChatHubSyncError({ operation });
  const config =
    sql<Config>`SELECT url,enabled,last_success,last_error FROM chat_hub_config WHERE id=1`.pipe(
      Effect.map((rows) => rows[0]!),
    );
  const token = secrets.get("chat-hub-write-token");
  const request = Effect.fn("ChatHubSync.request")(
    function* (path: string, body?: unknown) {
      const c = yield* config;
      const t = yield* token;
      if (!c.url || Option.isNone(t)) return yield* failure("request");
      const req = HttpClientRequest.make(body === undefined ? "GET" : "PUT")(
        `${c.url}/v1/${path}`,
      ).pipe(HttpClientRequest.bearerToken(new TextDecoder().decode(t.value)));
      const response = yield* (
        body === undefined ? Effect.succeed(req) : HttpClientRequest.bodyJson(req, body)
      ).pipe(Effect.flatMap(client.execute), Effect.timeout("30 seconds"));
      if (response.status < 200 || response.status >= 300)
        return yield* failure(`request (HTTP ${response.status})`);
      return response;
    },
    Effect.mapError(() => failure("request")),
  );
  const status = Effect.gen(function* () {
    const c = yield* config;
    const t = yield* token;
    const rows = yield* sql<{
      count: number;
    }>`SELECT COUNT(*) AS count FROM orchestration_v2_projection_threads t LEFT JOIN chat_hub_manifest m ON m.thread_id=t.thread_id WHERE m.pushed_at IS NULL OR m.updated_at < t.updated_at`;
    return {
      url: c.url,
      enabled: c.enabled === 1,
      configured: c.url !== "" && Option.isSome(t),
      lastSuccess: c.last_success,
      lastError: c.last_error,
      pendingCount: rows[0]?.count ?? 0,
    };
  }).pipe(Effect.mapError(() => failure("status")));
  const sweep = Effect.gen(function* () {
    const c = yield* config;
    if (!c.enabled || !c.url || Option.isNone(yield* token)) return;
    const now = yield* Clock.currentTimeMillis;
    const cutoff = DateTime.formatIso(DateTime.makeUnsafe(now - 10_000));
    const rows = yield* sql<{ thread_id: string; updated_at: string; attempts: number | null }>`
     SELECT t.thread_id,t.updated_at,m.attempts FROM orchestration_v2_projection_threads t
     LEFT JOIN chat_hub_manifest m ON m.thread_id=t.thread_id
     WHERE (m.pushed_at IS NULL OR m.updated_at < t.updated_at)
       AND t.updated_at <= ${cutoff} AND (m.retry_at IS NULL OR m.retry_at <= ${now})
     ORDER BY t.updated_at LIMIT 50`;
    yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const exported = yield* threads
            .exportThread(ThreadId.make(row.thread_id))
            .pipe(
              Effect.provideService(ServerEnvironment.ServerEnvironmentIdentity, identity),
              Effect.provideService(ProjectStore.ProjectStoreV2, projects),
            );
          // Projection revisions also cover title, archive and deletion changes without new messages.
          const updatedAt = DateTime.formatIso(
            DateTime.makeUnsafe(
              Math.max(Date.parse(row.updated_at), Date.parse(exported.meta.updatedAt)),
            ),
          );
          const bundle = { ...exported.bundle, updatedAt };
          const response = yield* request(
            `threads/${encodeURIComponent(exported.meta.environmentId)}/${encodeURIComponent(row.thread_id)}`,
            {
              meta: { ...exported.meta, updatedAt },
              bundle,
              markdown: renderThreadExportMarkdown(bundle),
            },
          );
          yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ChatHubStored)));
          const at = DateTime.formatIso(yield* DateTime.now);
          yield* sql`INSERT INTO chat_hub_manifest (thread_id,updated_at,pushed_at) VALUES (${row.thread_id},${row.updated_at},${at}) ON CONFLICT(thread_id) DO UPDATE SET updated_at=excluded.updated_at,pushed_at=excluded.pushed_at,attempts=0,retry_at=0`;
          yield* sql`UPDATE chat_hub_config SET last_success=${at},last_error=NULL WHERE id=1`;
        }).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              const attempts = (row.attempts ?? 0) + 1;
              const retryAt = now + (attempts >= 5 ? 15 * 60_000 : 2 ** attempts * 10_000);
              yield* sql`INSERT INTO chat_hub_manifest (thread_id,updated_at,attempts,retry_at) VALUES (${row.thread_id},${row.updated_at},${attempts >= 5 ? 0 : attempts},${retryAt}) ON CONFLICT(thread_id) DO UPDATE SET attempts=excluded.attempts,retry_at=excluded.retry_at`;
              yield* sql`UPDATE chat_hub_config SET last_error='A thread could not be uploaded; retry scheduled.' WHERE id=1`;
            }),
          ),
        ),
      { concurrency: 2, discard: true },
    );
  }).pipe(
    lock.withPermit,
    Effect.mapError(() => failure("sync")),
  );
  const configure = Effect.fn("ChatHubSync.configure")(
    function* (input: typeof ChatHubConfigure.Type) {
      const url = input.url.trim().replace(/\/+$/, "");
      if (url) {
        const parsed = yield* Effect.try({
          try: () => new URL(url),
          catch: () => failure("configuration"),
        });
        if (
          parsed.protocol !== "https:" ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash ||
          parsed.pathname !== "/"
        )
          return yield* failure("configuration (use an HTTPS origin)");
      }
      if (input.enabled && !url) return yield* failure("configuration");
      const old = yield* config;
      if (input.token !== undefined && input.token.trim())
        yield* secrets.set("chat-hub-write-token", new TextEncoder().encode(input.token.trim()));
      if (old.url !== url) yield* sql`DELETE FROM chat_hub_manifest`;
      yield* sql`UPDATE chat_hub_config SET url=${url}, enabled=${input.enabled ? 1 : 0},last_error=NULL WHERE id=1`;
      return yield* status;
    },
    lock.withPermit,
    Effect.mapError(() => failure("configuration")),
  );
  const list = Effect.fn("ChatHubSync.list")(
    function* (input: typeof ChatHubQuery.Type) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(input))
        if (value !== undefined && value !== "") query.set(key, String(value));
      return yield* (yield* request(`threads?${query}`)).json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ChatHubList)),
      );
    },
    Effect.mapError(() => failure("list")),
  );
  const get = Effect.fn("ChatHubSync.get")(
    function* (input: typeof ChatHubLookup.Type) {
      const path = `threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
      const thread = yield* (yield* request(path)).json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ChatHubThread)),
      );
      const markdown = yield* (yield* request(`${path}?format=md`)).text;
      return { ...thread, markdown };
    },
    Effect.mapError(() => failure("read")),
  );
  const environments = Effect.gen(function* () {
    return yield* (yield* request("environments")).json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ChatHubEnvironments)),
    );
  }).pipe(Effect.mapError(() => failure("environments")));
  const syncNow = sql`UPDATE chat_hub_manifest SET retry_at=0,attempts=0`.pipe(
    Effect.andThen(status),
    Effect.mapError(() => failure("sync")),
  );
  return ChatHubSync.of({ status, configure, sweep, syncNow, list, get, environments });
});
export const layer = Layer.effect(ChatHubSync, make);
export const worker = Layer.effectDiscard(
  Effect.gen(function* () {
    const sync = yield* ChatHubSync;
    yield* sync.sweep.pipe(
      Effect.catch(() => Effect.logWarning("Chat hub sweep failed")),
      Effect.repeat(Schedule.spaced("10 seconds")),
      Effect.forkScoped,
    );
  }),
);
