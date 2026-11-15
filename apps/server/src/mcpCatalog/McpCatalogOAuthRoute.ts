import { MCP_CATALOG_OAUTH_CALLBACK_PATH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as McpCatalog from "./McpCatalog.ts";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

const page = (title: string, detail: string, status: number) =>
  HttpServerResponse.text(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#171717}@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.15rem;margin:0 0 .5rem}p{margin:0;opacity:.7}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`,
    {
      status,
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    },
  );

/**
 * The browser returns here from an MCP server's sign-in. It carries no T3 Code credential; the
 * one-time `state` from the sign-in this environment started is what it proves.
 */
export const layer = HttpRouter.add(
  "GET",
  MCP_CATALOG_OAUTH_CALLBACK_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const catalog = yield* McpCatalog.McpCatalog;
    const params = new URL(request.url, "http://callback").searchParams;
    const state = params.get("state");
    if (state === null) {
      return page("Sign-in link is incomplete", "Start the sign-in again from Settings.", 400);
    }
    return yield* catalog
      .completeSignIn({
        state,
        code: params.get("code") ?? undefined,
        error: params.get("error") ?? undefined,
      })
      .pipe(
        Effect.map(({ serverName }) =>
          page(
            `Signed in to ${serverName}`,
            "Agents can use its tools now. You can close this tab.",
            200,
          ),
        ),
        Effect.catchTags({
          McpCatalogError: (error) =>
            Effect.succeed(page("Sign-in did not finish", error.message, 400)),
        }),
      );
  }),
);
