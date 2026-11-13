import * as NodeSqlite from "node:sqlite";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The SQLite fixture reads the deployed SQL migration directly.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import worker, { ThreadCoordinator, type Env } from "./index.ts";

function setup() {
  const sqlite = new NodeSqlite.DatabaseSync(":memory:");
  sqlite.exec(
    NodeFS.readFileSync(
      NodeURL.fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url).href),
      "utf8",
    ),
  );
  class Statement {
    private values: NodeSqlite.SQLInputValue[] = [];
    readonly sql: string;
    constructor(sql: string) {
      this.sql = sql;
    }
    bind(...values: NodeSqlite.SQLInputValue[]) {
      this.values = values;
      return this;
    }
    async first() {
      return sqlite.prepare(this.sql).get(...this.values) ?? null;
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...this.values) };
    }
    async run() {
      return sqlite.prepare(this.sql).run(...this.values);
    }
  }
  const objects = new Map<string, string>();
  const writes: string[] = [];
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const coordinators = new Map<string, ThreadCoordinator>();
  const env = {
    DB: db as unknown as D1Database,
    BUCKET: {
      put: async (key: string, value: string) => {
        writes.push(key);
        objects.set(key, value);
      },
      get: async (key: string) => {
        const value = objects.get(key);
        return value === undefined
          ? null
          : { text: async () => value, json: async () => JSON.parse(value) };
      },
      delete: async (keys: string[]) => {
        for (const key of keys) objects.delete(key);
      },
    } as unknown as R2Bucket,
    THREADS: {
      idFromName: (name: string) => name,
      get: (name: string) => {
        let coordinator = coordinators.get(name);
        if (!coordinator) {
          let pending = Promise.resolve();
          const state = {
            blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
              const result = pending.then(fn);
              pending = result.then(
                () => {},
                () => {},
              );
              return result;
            },
          } as unknown as DurableObjectState;
          coordinator = new ThreadCoordinator(state, env);
          coordinators.set(name, coordinator);
        }
        return coordinator;
      },
    } as unknown as DurableObjectNamespace,
    ADMIN_TOKEN: "admin-secret",
    ALLOWED_ORIGINS: "https://app.t3.codes, https://other.example",
  } satisfies Env;
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    token: string | null = "admin-secret",
  ) {
    return worker.fetch(
      new Request(`https://hub.example/v1${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
  }
  async function mint(scope: "read" | "write") {
    const response = await call("/tokens", "POST", { label: "test", scope });
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string; token: string };
  }
  return { env, call, mint, sqlite, objects, writes, [Symbol.dispose]: () => sqlite.close() };
}
const input = (
  threadId = "thread",
  updatedAt = "2026-01-01T00:00:00.000Z",
  environmentId = "mac",
) => ({
  meta: {
    environmentId,
    environmentLabel: "Mac",
    threadId,
    title: "Hello world",
    projectTitle: "T3",
    workspaceRoot: "/code",
    provider: null,
    model: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt,
    archived: false,
    deletedAt: null,
    messageCount: 2,
  },
  markdown: "Hello searchable world",
  bundle: { arbitrary: [1, "opaque", null] },
});

it("hashes tokens, enforces scopes and revocation, and never lists secrets", async () => {
  using s = setup();
  expect((await s.call("/health", "GET", undefined, null)).status).toBe(200);
  for (const token of [null, "bad"])
    expect((await s.call("/threads", "GET", undefined, token)).status).toBe(401);
  const read = await s.mint("read");
  const write = await s.mint("write");
  expect(read.token).toMatch(/^[a-f0-9]{64}$/);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(read.token));
  expect(s.sqlite.prepare("SELECT hash FROM tokens WHERE id=?").get(read.id)?.hash).toBe(
    Buffer.from(digest).toString("hex"),
  );
  expect((await s.call("/threads/mac/thread", "PUT", input(), read.token)).status).toBe(403);
  expect((await s.call("/threads/mac/thread", "PUT", input(), write.token)).status).toBe(200);
  expect((await s.call("/threads", "GET", undefined, write.token)).status).toBe(200);
  expect((await s.call("/tokens", "GET", undefined, write.token)).status).toBe(403);
  expect((await s.call("/threads/mac/thread", "DELETE", undefined, write.token)).status).toBe(403);
  const listing = await (await s.call("/tokens")).text();
  expect(listing).not.toContain(read.token);
  expect(listing).not.toContain('"hash"');
  expect(
    s.sqlite.prepare("SELECT last_used_at FROM tokens WHERE id=?").get(write.id)?.last_used_at,
  ).toBeTruthy();
  await s.call(`/tokens/${read.id}`, "DELETE");
  expect((await s.call("/threads", "GET", undefined, read.token)).status).toBe(401);
});

it("stores opaque bundles and markdown, ignores equal/older PUTs, and serializes concurrent updates", async () => {
  using s = setup();
  const newer = input("thread", "2026-02-01T00:00:00.000Z");
  expect(await (await s.call("/threads/mac/thread", "PUT", newer)).json()).toEqual({
    stored: true,
  });
  const results = await Promise.all([
    s.call("/threads/mac/thread", "PUT", newer),
    s.call("/threads/mac/thread", "PUT", input()),
  ]);
  for (const response of results) expect(await response.json()).toEqual({ stored: false });
  expect(s.writes).toHaveLength(2);
  expect(await (await s.call("/threads/mac/thread")).json()).toEqual({
    meta: newer.meta,
    bundle: newer.bundle,
  });
  const md = await s.call("/threads/mac/thread?format=md");
  expect(md.headers.get("Content-Type")).toContain("text/markdown");
  expect(await md.text()).toBe(newer.markdown);
  expect(await (await s.call("/environments")).json()).toEqual({
    items: [
      {
        environmentId: "mac",
        environmentLabel: "Mac",
        threadCount: 1,
        updatedAt: newer.meta.updatedAt,
      },
    ],
  });
  await s.call("/threads/mac/thread", "DELETE");
  expect((await s.call("/threads/mac/thread")).status).toBe(404);
  expect(s.objects.size).toBe(0);
  expect(s.sqlite.prepare("SELECT count(*) AS n FROM thread_search").get()?.n).toBe(0);
});

it("accepts percent-encoded T3 ids with colons and rejects ids outside the id alphabet", async () => {
  using s = setup();
  const realId = "mcp:launch:3f2a%3Aordinal";
  expect(
    (await s.call(`/threads/mac/${encodeURIComponent(realId)}`, "PUT", input(realId))).status,
  ).toBe(200);
  expect((await s.call(`/threads/mac/${encodeURIComponent(realId)}`)).status).toBe(200);
  expect((await s.call("/threads/mac/bad%20id", "PUT", input("bad id"))).status).toBe(404);
});

it("rejects mismatched ids, invalid bodies/dates and both declared and streamed oversized bodies", async () => {
  using s = setup();
  expect((await s.call("/threads/mac/other", "PUT", input())).status).toBe(400);
  expect(
    (await s.call("/threads/mac/thread", "PUT", { ...input(), bundle: undefined })).status,
  ).toBe(400);
  expect(
    (await s.call("/threads/mac/thread", "PUT", input("thread", "2026-02-30T00:00:00.000Z")))
      .status,
  ).toBe(400);
  for (const declared of [true, false]) {
    const response = await worker.fetch(
      new Request("https://hub.example/v1/threads/mac/thread", {
        method: "PUT",
        headers: {
          Authorization: "Bearer admin-secret",
          ...(declared ? { "Content-Length": "10485761" } : {}),
        },
        body: "x".repeat(10485761),
      }),
      s.env,
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toContain("10 MiB");
  }
  expect(s.objects.size).toBe(0);
  const normalized = await s.call("/threads/mac/thread", "PUT", {
    ...input("thread", "2026-01-01T01:00:00+01:00"),
    bundle: null,
  });
  expect(normalized.status).toBe(200);
  expect(await (await s.call("/threads/mac/thread")).json()).toMatchObject({
    meta: { updatedAt: "2026-01-01T00:00:00.000Z" },
    bundle: null,
  });
});

it("paginates ties by keyset, filters archives/deletions/projects and safely searches hostile FTS input", async () => {
  using s = setup();
  for (const [env, id] of [
    ["mac", "a"],
    ["mac", "b"],
    ["vps", "a"],
  ])
    await s.call(`/threads/${env}/${id}`, "PUT", input(id, undefined, env));
  const first = (await (await s.call("/threads?limit=1")).json()) as {
    items: { threadId: string; environmentId: string }[];
    nextCursor: string;
  };
  expect(first.items.map((i) => [i.environmentId, i.threadId])).toEqual([["vps", "a"]]);
  await s.call("/threads/mac/new", "PUT", input("new", "2026-02-01T00:00:00.000Z"));
  const second = (await (
    await s.call(`/threads?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)
  ).json()) as { items: { threadId: string }[]; nextCursor: null };
  expect(second.items.map((i) => i.threadId)).toEqual(["b", "a"]);
  expect(second.nextCursor).toBeNull();
  for (const q of ['" OR * NOT (', 'hello"; DROP TABLE threads; --', "NEAR(", "*", '"', "world"]) {
    const result = await s.call(`/threads?q=${encodeURIComponent(q)}`);
    expect(result.status).toBe(200);
    if (q === "world") expect(await result.text()).toContain('"snippet"');
  }
  await s.call("/threads/mac/archived", "PUT", {
    ...input("archived"),
    meta: { ...input("archived").meta, archived: true },
  });
  await s.call("/threads/mac/deleted", "PUT", {
    ...input("deleted"),
    meta: { ...input("deleted").meta, deletedAt: "2026-01-01T00:00:00.000Z" },
  });
  const count = async (query: string) =>
    ((await (await s.call(`/threads?${query}`)).json()) as { items: unknown[] }).items.length;
  expect(await count("")).toBe(4);
  expect(await count("includeArchived=true&includeDeleted=true")).toBe(6);
  expect(await count("environmentId=vps&project=T3")).toBe(1);
  expect(await count("project=absent")).toBe(0);
  expect((await s.call("/threads?cursor=bad")).status).toBe(400);
});

it("handles allowed preflights without auth and rejects unconfigured origins", async () => {
  using s = setup();
  for (const origin of ["https://app.t3.codes", "https://evil.example"]) {
    const result = await worker.fetch(
      new Request("https://hub.example/v1/threads", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT" },
      }),
      s.env,
    );
    expect(result.status).toBe(origin.includes("evil") ? 403 : 204);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(
      origin.includes("evil") ? null : origin,
    );
  }
});
