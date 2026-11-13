# T3 Code Chat Hub

A standalone Cloudflare Worker that stores searchable copies of threads from multiple T3 environments. D1 holds metadata, FTS5 search text and token hashes; R2 holds opaque JSON bundles and Markdown. Original machines can be offline when reading the hub. This package does not implement server push or a client UI.

**Cloudflare can read the chats. There is no end-to-end encryption in v1.** Treat both API tokens and the stored chats as sensitive. All read tokens can read all environments; write tokens can read and update all environments. Use a separate write token per machine for revocation and auditing. The admin secret can also read and write, and is the only credential allowed to manage tokens or hard-delete threads.

## Deployment

Run these commands from `apps/chat-hub`. Deployment is manual; nothing in this package deploys automatically. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in your deployment shell or CI, outside the repository. No account id or credentials belong in source control.

The configured D1 database and R2 bucket already exist. **Do not recreate them for this installation.** For a new installation, create resources and replace the database id and resource names in `wrangler.toml`:

```sh
vp exec wrangler d1 create t3code-chat-hub
vp exec wrangler r2 bucket create t3code-chat-hub
```

For the existing installation, configure the comma-separated exact browser origins in `[vars].ALLOWED_ORIGINS` in `wrangler.toml` (default: `https://app.t3.codes`), then run:

```sh
vp exec wrangler d1 migrations apply t3code-chat-hub --remote
vp exec wrangler secret put ADMIN_TOKEN
vp exec wrangler deploy
```

Supply a randomly generated 32-byte admin secret at the secret prompt; for example, generate one locally with `openssl rand -hex 32`. Do not commit it. The deploy creates the `THREADS` SQLite Durable Object namespace via the bundled `v1` migration. It serializes operations per thread so concurrent requests cannot overwrite newer snapshots. A D1/R2 shared transaction does not exist: failed object writes or a failed D1 commit require retrying the PUT; backups of the two stores should be coordinated.

## Tokens

After deployment, set `HUB_URL` to the Worker's HTTPS origin and `ADMIN_TOKEN` in your local shell. Mint one write token for each machine, and read tokens for clients:

```sh
curl --fail-with-body "$HUB_URL/v1/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data '{"label":"Mac","scope":"write"}'
curl --fail-with-body "$HUB_URL/v1/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data '{"label":"VPS 1","scope":"write"}'
curl --fail-with-body "$HUB_URL/v1/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data '{"label":"VPS 2","scope":"write"}'
curl --fail-with-body "$HUB_URL/v1/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data '{"label":"Web client","scope":"read"}'
curl --fail-with-body "$HUB_URL/v1/tokens" -H "Authorization: Bearer $ADMIN_TOKEN"
curl --fail-with-body -X DELETE "$HUB_URL/v1/tokens/$TOKEN_ID" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Each mint returns `{id, token}`. Save the token immediately: it is returned only once. Tokens contain 32 random bytes encoded as 64 lowercase hex characters. D1 stores only SHA-256 hex digests, never plaintext tokens. Revocation returns `{revoked:true}` and is idempotent.

## API v1

All routes below are relative to `/v1`. JSON request/response schemas are exported from `@t3tools/contracts/chat-hub`. All authenticated requests use `Authorization: Bearer <token>`. Write implies read. Missing, invalid or revoked credentials return 401; valid credentials with insufficient scope return 403. Errors are `{error:{code,message}}`. All responses disable caching. Configured browser origins receive CORS headers; preflight needs no auth, and unconfigured origins receive 403.

- `GET /health`: public, `{ok:true,version:"1"}`.
- `POST /tokens`: admin, `{label,scope:"read"|"write"}` → `{id,token}`.
- `GET /tokens`: admin, `{items:[{id,label,scope,created_at,last_used_at,revoked_at}]}`; no hashes or secrets.
- `DELETE /tokens/:id`: admin, `{revoked:true}` (including unknown ids).
- `PUT /threads/:environmentId/:threadId`: write, `{meta,markdown,bundle}` → `{stored:true}` or `{stored:false}` when stored `updatedAt` is equal or newer. R2 objects are `threads/<environmentId>/<threadId>.json` and `.md`, written before the D1 metadata/search batch. `bundle` is any JSON value, including null, and is not interpreted. The whole JSON request body is limited to 10 MiB (10,485,760 bytes), including chunked requests; larger bodies return 413.
- `GET /threads`: read, `{items:[meta + optional snippet],nextCursor:string|null}`. `q` searches title and Markdown as literal whitespace-separated terms joined with AND, never raw FTS syntax. Snippets are plain text excerpts (24 FTS tokens), not HTML. `environmentId` and `project` filter exact environment id and project title. `includeArchived=true` and `includeDeleted=true` opt into hidden records independently. `limit` defaults to 50, caps at 200, and must be a positive integer. `cursor` is opaque and must be URL encoded; keep the same filters when continuing a page. Ordering is `updatedAt DESC, environmentId DESC, threadId DESC`, using keyset pagination, not offsets. This is a live list, not a frozen snapshot: records updated across the cursor between requests can move to an earlier page.
- `GET /threads/:environmentId/:threadId`: read, `{meta,bundle}`; add `?format=md` for `text/markdown; charset=utf-8`. Direct lookup includes archived/deleted records. Missing records return 404.
- `GET /environments`: read, `{items:[{environmentId,environmentLabel,threadCount,updatedAt}]}`; excludes deleted threads, includes archived threads, uses the newest thread's environment label, sorted newest first.
- `DELETE /threads/:environmentId/:threadId`: admin, removes metadata/search rows first, then R2 objects, returns `{deleted:boolean}`. No writer delete route: writers publish `meta.deletedAt`. A later PUT can recreate a hard-deleted thread.

`meta` has exactly these fields: `environmentId`, `environmentLabel`, `threadId`, `title`, `projectTitle` (string/null), `workspaceRoot` (string/null), `provider` (string/null), `model` (string/null), `createdAt`, `updatedAt`, `archived` (boolean), `deletedAt` (timestamp/null), `messageCount` (nonnegative integer). All unmarked fields are strings. Path ids must match metadata ids, or the response is 400. IDs use 1–256 ASCII letters, digits, hyphens or underscores. Timestamps accept ISO 8601 with a timezone (optional 1–3 fractional digits) and are normalized to UTC with milliseconds (`2026-01-01T00:00:00.000Z`) so ordering is unambiguous; invalid dates return 400. Malformed filters/cursors/JSON return 400. Search queries are limited to 1,000 characters.

## Local checks

From the repository root:

```sh
vp test run apps/chat-hub/src/index.test.ts
vp run --filter @t3tools/chat-hub typecheck
vp run check:changed --concurrency 1
```

Tests execute the real SQL migration and FTS5 queries against in-memory SQLite, with D1/R2 and Durable Object adapters. A real Cloudflare deployment, credentials, bindings and production limits must be verified separately.
