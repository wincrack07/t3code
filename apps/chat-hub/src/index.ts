import {
  CHAT_HUB_ID_PATTERN,
  ChatHubMeta,
  ChatHubPut,
  ChatHubTokenInput,
} from "@t3tools/contracts/chat-hub";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  THREADS: DurableObjectNamespace;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

const VERSION = "1";
const MAX_BODY = 10 * 1024 * 1024;
class HttpError extends Schema.TaggedError<HttpError, { readonly brand: unique symbol }>()(
  "HttpError",
  {
    status: Schema.Number,
    code: Schema.String,
    message: Schema.String,
  },
) {}
function fail(status: number, code: string, message: string): never {
  throw new HttpError({ status, code, message });
}
const now = () => DateTime.formatIso(DateTime.nowUnsafe());
const isHttpError = Schema.is(HttpError);
function errorResponse(error: unknown) {
  return isHttpError(error)
    ? json({ error: { code: error.code, message: error.message } }, error.status)
    : json({ error: { code: "internal_error", message: "An internal error occurred" } }, 500);
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function hash(token: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
function equal(a: Uint8Array, b: Uint8Array) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ (b[i] ?? 0);
  return difference === 0;
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function authorize(request: Request, env: Env, scope: "read" | "write" | "admin") {
  const token = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!token) fail(401, "unauthorized", "A valid bearer token is required");
  const digest = await hash(token);
  if (env.ADMIN_TOKEN && equal(digest, await hash(env.ADMIN_TOKEN))) return;
  const row = await env.DB.prepare(
    "SELECT id, hash, scope FROM tokens WHERE hash = ? AND revoked_at IS NULL",
  )
    .bind(hex(digest))
    .first<{ id: string; hash: string; scope: string }>();
  if (!row || !equal(new TextEncoder().encode(row.hash), new TextEncoder().encode(hex(digest)))) {
    fail(401, "unauthorized", "A valid bearer token is required");
  }
  if (scope === "admin" || (scope === "write" && row.scope !== "write"))
    fail(403, "forbidden", "Token does not have the required scope");
  await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now(), row.id)
    .run();
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY)
    fail(413, "body_too_large", "Request body exceeds 10 MiB");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_json", "A JSON body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) {
      await reader.cancel();
      fail(413, "body_too_large", "Request body exceeds 10 MiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail(400, "invalid_json", "Request body must be valid JSON");
  }
}
function decode<S extends Schema.Top>(schema: S, value: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema as never)(value);
  } catch {
    return fail(400, "invalid_request", "Request does not match the v1 schema");
  }
}
function threadIds(url: URL) {
  const match = /^\/v1\/threads\/([^/]{1,1024})\/([^/]{1,1024})$/.exec(url.pathname);
  if (!match) return null;
  try {
    const ids = [decodeURIComponent(match[1]!), decodeURIComponent(match[2]!)] as const;
    return ids.every((id) => CHAT_HUB_ID_PATTERN.test(id)) ? ids : null;
  } catch {
    return null;
  }
}

// D1 and R2 have no shared transaction; serialize each thread across Worker instances.
export class ThreadCoordinator {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }
  fetch(request: Request) {
    return this.state.blockConcurrencyWhile(async () => {
      try {
        return await threadRequest(request, this.env);
      } catch (error) {
        return errorResponse(error);
      }
    });
  }
}
async function threadRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const ids = threadIds(url);
  if (!ids) return fail(404, "not_found", "Thread route not found");
  const [environmentId, threadId] = ids;
  const key = `threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
  const row = await env.DB.prepare(
    "SELECT id, meta, updated_at FROM threads WHERE environment_id = ? AND thread_id = ?",
  )
    .bind(environmentId, threadId)
    .first<{ id: number; meta: string; updated_at: string }>();
  if (request.method === "PUT") {
    const decoded = decode(ChatHubPut, await readJson(request));
    const normalize = (value: string) => {
      if (
        !Number.isFinite(Date.parse(value)) ||
        DateTime.formatIso(DateTime.makeUnsafe(value.slice(0, 19) + "Z")).slice(0, 19) !==
          value.slice(0, 19)
      )
        return fail(400, "invalid_timestamp", "Invalid timestamp");
      return DateTime.formatIso(DateTime.makeUnsafe(value));
    };
    const input = {
      ...decoded,
      meta: {
        ...decoded.meta,
        createdAt: normalize(decoded.meta.createdAt),
        updatedAt: normalize(decoded.meta.updatedAt),
        deletedAt: decoded.meta.deletedAt === null ? null : normalize(decoded.meta.deletedAt),
      },
    };
    if (input.meta.environmentId !== environmentId || input.meta.threadId !== threadId)
      fail(400, "id_mismatch", "Path ids must equal meta ids");
    if (row && row.updated_at >= input.meta.updatedAt) return json({ stored: false });
    await env.BUCKET.put(`${key}.json`, JSON.stringify(input.bundle), {
      httpMetadata: { contentType: "application/json" },
    });
    await env.BUCKET.put(`${key}.md`, input.markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    const meta = input.meta;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO threads (environment_id, thread_id, updated_at, project, archived, deleted_at, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(environment_id, thread_id) DO UPDATE SET
        updated_at=excluded.updated_at, project=excluded.project, archived=excluded.archived, deleted_at=excluded.deleted_at, meta=excluded.meta`).bind(
        environmentId,
        threadId,
        meta.updatedAt,
        meta.projectTitle,
        Number(meta.archived),
        meta.deletedAt,
        JSON.stringify(meta),
      ),
      env.DB.prepare(
        "DELETE FROM thread_search WHERE rowid = (SELECT id FROM threads WHERE environment_id = ? AND thread_id = ?)",
      ).bind(environmentId, threadId),
      env.DB.prepare(
        "INSERT INTO thread_search(rowid, title, markdown) SELECT id, ?, ? FROM threads WHERE environment_id = ? AND thread_id = ?",
      ).bind(meta.title, input.markdown, environmentId, threadId),
    ]);
    return json({ stored: true });
  }
  if (request.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM thread_search WHERE rowid = (SELECT id FROM threads WHERE environment_id = ? AND thread_id = ?)",
      ).bind(environmentId, threadId),
      env.DB.prepare("DELETE FROM threads WHERE environment_id = ? AND thread_id = ?").bind(
        environmentId,
        threadId,
      ),
    ]);
    await env.BUCKET.delete([`${key}.json`, `${key}.md`]);
    return json({ deleted: row !== null });
  }
  if (!row) return fail(404, "not_found", "Thread not found");
  const markdown = url.searchParams.get("format") === "md";
  const object = await env.BUCKET.get(`${key}.${markdown ? "md" : "json"}`);
  if (!object) return fail(503, "object_unavailable", "Thread object is unavailable; retry later");
  return markdown
    ? new Response(await object.text(), {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      })
    : json({ meta: JSON.parse(row.meta), bundle: await object.json() });
}

const Cursor = Schema.Tuple([Schema.String, Schema.String, Schema.String]);
async function listThreads(url: URL, env: Env) {
  const params = url.searchParams;
  const rawLimit = params.get("limit") ?? "50";
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || !Number.isSafeInteger(Number(rawLimit)))
    fail(400, "invalid_limit", "limit must be a positive integer");
  const limit = Math.min(Number(rawLimit), 200);
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  const q = params.get("q")?.trim();
  if (q && q.length > 1000) fail(400, "invalid_query", "Search query exceeds 1000 characters");
  if (q) {
    clauses.push("thread_search MATCH ?");
    values.push(
      q
        .split(/\s+/u)
        .map((word) => `"${word.replaceAll('"', '""')}"`)
        .join(" AND "),
    );
  }
  for (const [param, column] of [
    ["environmentId", "t.environment_id"],
    ["project", "t.project"],
  ] as const) {
    if (params.has(param)) {
      clauses.push(`${column} = ?`);
      values.push(params.get(param)!);
    }
  }
  for (const param of ["includeArchived", "includeDeleted"]) {
    if (params.has(param) && !["true", "false"].includes(params.get(param)!))
      fail(400, "invalid_filter", `${param} must be true or false`);
  }
  if (params.get("includeArchived") !== "true") clauses.push("t.archived = 0");
  if (params.get("includeDeleted") !== "true") clauses.push("t.deleted_at IS NULL");
  const cursor = params.get("cursor");
  if (cursor) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(atob(cursor));
    } catch {
      fail(400, "invalid_cursor", "Invalid cursor");
    }
    const decoded = decode(Cursor, parsed);
    clauses.push("(t.updated_at, t.environment_id, t.thread_id) < (?, ?, ?)");
    values.push(...decoded);
  }
  const result =
    await env.DB.prepare(`SELECT t.meta${q ? ", snippet(thread_search, -1, '', '', '…', 24) AS snippet" : ""}
    FROM threads t ${q ? "JOIN thread_search ON thread_search.rowid = t.id" : ""}
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY t.updated_at DESC, t.environment_id DESC, t.thread_id DESC LIMIT ?`)
      .bind(...values, limit + 1)
      .all<{ meta: string; snippet?: string }>();
  const rows = result.results.slice(0, limit);
  const items = rows.map((r) => ({
    ...decode(ChatHubMeta, JSON.parse(r.meta)),
    ...(r.snippet === undefined ? {} : { snippet: r.snippet }),
  }));
  const last = items.at(-1);
  return json({
    items,
    nextCursor:
      result.results.length > limit && last
        ? btoa(JSON.stringify([last.updatedAt, last.environmentId, last.threadId]))
        : null,
  });
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/v1/health" && request.method === "GET")
    return json({ ok: true, version: VERSION });
  const tokenRoute = /^\/v1\/tokens(?:\/([A-Za-z0-9-]+))?$/.exec(url.pathname);
  const ids = threadIds(url);
  await authorize(
    request,
    env,
    tokenRoute || request.method === "DELETE"
      ? "admin"
      : request.method === "PUT"
        ? "write"
        : "read",
  );
  if (tokenRoute) {
    const id = tokenRoute[1];
    if (!id && request.method === "POST") {
      const input = decode(ChatHubTokenInput, await readJson(request));
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenId = hex(crypto.getRandomValues(new Uint8Array(16)));
      await env.DB.prepare(
        "INSERT INTO tokens (id, label, hash, scope, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(tokenId, input.label, hex(await hash(token)), input.scope, now())
        .run();
      return json({ id: tokenId, token });
    }
    if (!id && request.method === "GET")
      return json({
        items: (
          await env.DB.prepare(
            "SELECT id, label, scope, created_at, last_used_at, revoked_at FROM tokens ORDER BY created_at DESC, id DESC",
          ).all()
        ).results,
      });
    if (id && request.method === "DELETE") {
      await env.DB.prepare("UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
        .bind(now(), id)
        .run();
      return json({ revoked: true });
    }
  }
  if (ids && ["GET", "PUT", "DELETE"].includes(request.method)) {
    const stub = env.THREADS.get(env.THREADS.idFromName(JSON.stringify(ids)));
    return stub.fetch(request);
  }
  if (url.pathname === "/v1/threads" && request.method === "GET") return listThreads(url, env);
  if (url.pathname === "/v1/environments" && request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT environment_id AS environmentId,
      json_extract(meta, '$.environmentLabel') AS environmentLabel, COUNT(*) AS threadCount, MAX(updated_at) AS updatedAt
      FROM threads WHERE deleted_at IS NULL GROUP BY environment_id ORDER BY updatedAt DESC, environmentId DESC`).all();
    return json({ items: rows.results });
  }
  return fail(404, "not_found", "Route not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let response: Response;
    try {
      if (origin && !allowed.includes(origin))
        fail(403, "origin_not_allowed", "Origin is not allowed");
      response =
        request.method === "OPTIONS"
          ? new Response(null, { status: 204 })
          : await route(request, env);
    } catch (error) {
      response = errorResponse(error);
    }
    response = new Response(response.body, response);
    response.headers.set("Vary", "Origin");
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (origin && allowed.includes(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    }
    return response;
  },
};
