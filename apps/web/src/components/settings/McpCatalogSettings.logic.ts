import type {
  McpCatalogServer,
  McpCatalogServerStatus,
  McpCatalogVariable,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

export interface VariableDraft {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
  // A secret saved before; a blank value keeps it.
  readonly stored: boolean;
}

export interface ServerDraft {
  readonly name: string;
  // Null until edited, so the id follows the name.
  readonly id: string | null;
  readonly type: "stdio" | "http";
  readonly commandLine: string;
  readonly cwd: string;
  readonly url: string;
  readonly env: ReadonlyArray<VariableDraft>;
  readonly headers: ReadonlyArray<VariableDraft>;
}

const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/u;

const serverIdFor = (name: string) => {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "")
    .slice(0, 40);
  return id === "" ? "server" : id;
};

/** Splits a command line as a shell would for plain words, quotes, and backslashes. */
export const splitCommandLine = (input: string): ReadonlyArray<string> => {
  const words: Array<string> = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < input.length) word += input[++index];
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (char === "\\" && index + 1 < input.length) {
      word += input[++index];
      inWord = true;
    } else if (/\s/u.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
};

export const joinCommandLine = (words: ReadonlyArray<string>) =>
  words
    .map((word) =>
      word === "" || /[\s"'\\]/u.test(word) ? `'${word.replace(/'/gu, `'"'"'`)}'` : word,
    )
    .join(" ");

let nextKey = 0;
export const variableKey = () => `variable-${(nextKey += 1)}`;

const toDrafts = (variables: ReadonlyArray<McpCatalogVariable>): ReadonlyArray<VariableDraft> =>
  variables.map((variable) => ({
    key: variableKey(),
    name: variable.name,
    value: variable.value,
    secret: variable.secret,
    stored: variable.stored === true,
  }));

export const emptyDraft = (): ServerDraft => ({
  name: "",
  id: null,
  type: "stdio",
  commandLine: "",
  cwd: "",
  url: "",
  env: [],
  headers: [],
});

export const draftFor = (server: McpCatalogServer): ServerDraft => ({
  name: server.name,
  id: server.id,
  type: server.transport.type,
  commandLine:
    server.transport.type === "stdio"
      ? joinCommandLine([server.transport.command, ...server.transport.args])
      : "",
  cwd: server.transport.type === "stdio" ? (server.transport.cwd ?? "") : "",
  url: server.transport.type === "http" ? server.transport.url : "",
  env: toDrafts(server.env),
  headers: toDrafts(server.headers),
});

export const draftId = (draft: ServerDraft) => draft.id ?? serverIdFor(draft.name);

/** The server a draft describes, or why it cannot be saved yet. */
export const serverFromDraft = (
  draft: ServerDraft,
  enabled: boolean,
  resolve: MessageResolver = m,
): { readonly server: McpCatalogServer } | { readonly error: string } => {
  const name = draft.name.trim();
  if (name === "") return { error: resolve(msg("Give the server a name.")) };
  const id = draftId(draft);
  if (!SERVER_ID_PATTERN.test(id)) {
    return {
      error: resolve(msg("The id takes lowercase letters, numbers, - and _, up to 40 characters.")),
    };
  }
  const variables = (drafts: ReadonlyArray<VariableDraft>) =>
    drafts
      .filter((variable) => variable.name.trim() !== "")
      .map((variable) => ({
        name: variable.name.trim(),
        value: variable.value,
        secret: variable.secret,
        ...(variable.secret && variable.stored && variable.value === "" ? { stored: true } : {}),
      }));
  if (draft.type === "stdio") {
    const [command, ...args] = splitCommandLine(draft.commandLine.trim());
    if (command === undefined) {
      return { error: resolve(msg("Enter the command that starts the server.")) };
    }
    const cwd = draft.cwd.trim();
    return {
      server: {
        id,
        name,
        enabled,
        transport: { type: "stdio", command, args, ...(cwd === "" ? {} : { cwd }) },
        env: variables(draft.env),
        headers: [],
      },
    };
  }
  const url = draft.url.trim();
  if (!/^https?:\/\/\S+$/u.test(url))
    return { error: resolve(msg("Enter a full URL, such as https://example.com/mcp.")) };
  return {
    server: {
      id,
      name,
      enabled,
      transport: { type: "http", url },
      env: [],
      headers: variables(draft.headers),
    },
  };
};

export const statusLabel = (
  status: McpCatalogServerStatus | undefined,
  resolve: MessageResolver = m,
): string => {
  switch (status?.state) {
    case "connected":
      return resolve(
        msg("{count, plural, one {{count} tool} other {{count} tools}}", {
          count: status.tools.length,
        }),
      );
    case "connecting":
      return resolve(msg("Connecting…"));
    case "error":
      return resolve(msg("Not connected"));
    case "disabled":
      return resolve(msg("Off", { $context: "status, the server is disabled" }));
    default:
      return resolve(msg("Not connected yet"));
  }
};

export const transportSummary = (server: McpCatalogServer) =>
  server.transport.type === "http"
    ? server.transport.url
    : joinCommandLine([server.transport.command, ...server.transport.args]);
