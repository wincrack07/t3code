import type {
  McpCatalogImportSource,
  McpCatalogServer,
  McpCatalogTransport,
  McpCatalogVariable,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export interface ImportCandidate {
  readonly source: McpCatalogImportSource;
  readonly server: McpCatalogServer;
  readonly secrets: {
    readonly env: Record<string, string>;
    readonly headers: Record<string, string>;
  };
}

/** Config folders of the user's other Claude and Codex accounts. */
export interface ImportHomes {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly claudeConfigDirs: ReadonlyArray<string>;
  readonly codexHomes: ReadonlyArray<string>;
}

interface RawServer {
  readonly name: string;
  readonly command?: string | undefined;
  readonly args?: ReadonlyArray<string> | undefined;
  readonly cwd?: string | undefined;
  readonly url?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly enabled?: boolean | undefined;
}

const SENSITIVE_NAME = /key|token|secret|pass|auth|cookie|credential|session|bearer/iu;

const catalogIdFor = (name: string) => {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "")
    .slice(0, 40);
  return id === "" ? "server" : id;
};

const variablesOf = (values: Readonly<Record<string, string>> | undefined) => {
  const variables: Array<McpCatalogVariable> = [];
  const secrets: Record<string, string> = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    if (name.trim() === "") continue;
    const secret = SENSITIVE_NAME.test(name);
    variables.push({ name: name.trim(), value: secret ? "" : value, secret });
    if (secret) secrets[name.trim()] = value;
  }
  return { variables, secrets };
};

export const toCandidate = (
  source: McpCatalogImportSource,
  raw: RawServer,
): ImportCandidate | null => {
  const transport: McpCatalogTransport | null =
    raw.command !== undefined && raw.command.trim() !== ""
      ? {
          type: "stdio",
          command: raw.command.trim(),
          args: [...(raw.args ?? [])],
          ...(raw.cwd ? { cwd: raw.cwd } : {}),
        }
      : raw.url !== undefined && raw.url.trim() !== ""
        ? { type: "http", url: raw.url.trim() }
        : null;
  if (transport === null) return null;
  const env = variablesOf(raw.env);
  const headers = variablesOf(raw.headers);
  return {
    source,
    server: {
      id: catalogIdFor(raw.name),
      name: raw.name.trim() === "" ? catalogIdFor(raw.name) : raw.name.trim(),
      enabled: raw.enabled !== false,
      transport,
      env: transport.type === "stdio" ? env.variables : [],
      headers: transport.type === "http" ? headers.variables : [],
    },
    secrets: {
      env: transport.type === "stdio" ? env.secrets : {},
      headers: transport.type === "http" ? headers.secrets : {},
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringRecord = (value: unknown): Record<string, string> | undefined =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, entry]) =>
          typeof entry === "string" ? [[key, entry]] : [],
        ),
      )
    : undefined;

const stringArray = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : undefined;

/** `mcpServers` as Claude Code, Claude Desktop, and Cursor write it. */
export const parseJsonMcpServers = (text: string): ReadonlyArray<RawServer> => {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return [];
  }
  const servers = isRecord(document) ? document.mcpServers : undefined;
  if (!isRecord(servers)) return [];
  return Object.entries(servers).flatMap(([name, value]) => {
    if (!isRecord(value)) return [];
    return [
      {
        name,
        command: typeof value.command === "string" ? value.command : undefined,
        args: stringArray(value.args),
        cwd: typeof value.cwd === "string" ? value.cwd : undefined,
        url: typeof value.url === "string" ? value.url : undefined,
        env: stringRecord(value.env),
        headers: stringRecord(value.headers),
        enabled: value.disabled === true ? false : undefined,
      },
    ];
  });
};

// Codex keeps MCP servers in TOML. This reads only the `[mcp_servers.*]` tables, with the
// value forms Codex writes there: strings, string arrays, booleans, and inline string tables.
const parseTomlString = (input: string): { value: string; rest: string } | null => {
  const quote = input[0];
  if (quote === "'") {
    const end = input.indexOf("'", 1);
    return end === -1 ? null : { value: input.slice(1, end), rest: input.slice(end + 1) };
  }
  if (quote !== '"') return null;
  let value = "";
  for (let index = 1; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "\\") {
      const next = input[index + 1];
      value += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
      index += 1;
    } else if (char === '"') {
      return { value, rest: input.slice(index + 1) };
    } else {
      value += char;
    }
  }
  return null;
};

type TomlValue = string | boolean | ReadonlyArray<string> | Readonly<Record<string, string>>;

const parseTomlValue = (input: string): TomlValue | undefined => {
  const text = input.trim();
  if (text === "true" || text === "false") return text === "true";
  if (text.startsWith('"') || text.startsWith("'")) return parseTomlString(text)?.value;
  if (text.startsWith("[")) {
    const items: Array<string> = [];
    let rest = text.slice(1).trim();
    while (rest !== "" && !rest.startsWith("]")) {
      const parsed = parseTomlString(rest);
      if (parsed === null) return undefined;
      items.push(parsed.value);
      rest = parsed.rest.trim().replace(/^,/u, "").trim();
    }
    return items;
  }
  if (text.startsWith("{")) {
    const table: Record<string, string> = {};
    let rest = text.slice(1).trim();
    while (rest !== "" && !rest.startsWith("}")) {
      const key = /^("[^"]*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*/u.exec(rest);
      if (key === null) return undefined;
      const parsed = parseTomlString(rest.slice(key[0].length));
      if (parsed === null) return undefined;
      table[key[1]!.replace(/^["']|["']$/gu, "")] = parsed.value;
      rest = parsed.rest.trim().replace(/^,/u, "").trim();
    }
    return table;
  }
  return undefined;
};

export const parseCodexMcpServers = (
  text: string,
  environment: Readonly<Record<string, string | undefined>> = {},
): ReadonlyArray<RawServer> => {
  const servers = new Map<string, Record<string, TomlValue>>();
  let current: { name: string; sub: string | null } | null = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/u.exec(line);
    if (header) {
      const parts = header[1]!.split(".").map((part) => part.trim().replace(/^["']|["']$/gu, ""));
      current =
        parts[0] === "mcp_servers" && parts.length >= 2
          ? { name: parts[1]!, sub: parts.length > 2 ? parts.slice(2).join(".") : null }
          : null;
      if (current !== null && !servers.has(current.name)) servers.set(current.name, {});
      continue;
    }
    if (current === null) continue;
    const assignment = /^("[^"]*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(line);
    if (!assignment) continue;
    const key = assignment[1]!.replace(/^["']|["']$/gu, "");
    const value = parseTomlValue(assignment[2]!.replace(/\s+#.*$/u, ""));
    if (value === undefined) continue;
    const server = servers.get(current.name)!;
    if (current.sub === null) {
      server[key] = value;
    } else if (typeof value === "string") {
      const table = server[current.sub];
      server[current.sub] = {
        ...(isRecord(table) ? (table as Record<string, string>) : {}),
        [key]: value,
      };
    }
  }
  return [...servers.entries()].map(([name, fields]) => {
    const text = (key: string) =>
      typeof fields[key] === "string" ? (fields[key] as string) : undefined;
    const table = (key: string) =>
      isRecord(fields[key]) ? (fields[key] as Readonly<Record<string, string>>) : undefined;
    const bearerVariable = text("bearer_token_env_var");
    const bearer = bearerVariable === undefined ? undefined : environment[bearerVariable];
    return {
      name,
      command: text("command"),
      args: Array.isArray(fields.args) ? (fields.args as ReadonlyArray<string>) : undefined,
      cwd: text("cwd"),
      url: text("url"),
      env: table("env"),
      headers: {
        ...table("http_headers"),
        ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      },
      enabled: fields.enabled === false ? false : undefined,
    };
  });
};

export const readImportCandidates = Effect.fn("McpCatalogImport.read")(function* (
  homes: ImportHomes,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file: string) =>
    fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  const desktopConfig =
    homes.platform === "darwin"
      ? path.join(
          homes.home,
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json",
        )
      : path.join(homes.home, ".config", "Claude", "claude_desktop_config.json");
  const sources: ReadonlyArray<{
    readonly source: McpCatalogImportSource;
    readonly file: string;
    readonly parse: (text: string) => ReadonlyArray<RawServer>;
  }> = [
    { source: "claude", file: path.join(homes.home, ".claude.json"), parse: parseJsonMcpServers },
    ...homes.claudeConfigDirs.map((dir) => ({
      source: "claude" as const,
      file: path.join(dir, ".claude.json"),
      parse: parseJsonMcpServers,
    })),
    { source: "claude-desktop", file: desktopConfig, parse: parseJsonMcpServers },
    {
      source: "codex",
      file: path.join(homes.home, ".codex", "config.toml"),
      parse: (text) => parseCodexMcpServers(text, homes.environment),
    },
    ...homes.codexHomes.map((dir) => ({
      source: "codex" as const,
      file: path.join(dir, "config.toml"),
      parse: (text: string) => parseCodexMcpServers(text, homes.environment),
    })),
    {
      source: "cursor",
      file: path.join(homes.home, ".cursor", "mcp.json"),
      parse: parseJsonMcpServers,
    },
  ];
  const candidates: Array<ImportCandidate> = [];
  const seen = new Set<string>();
  for (const { source, file, parse } of sources) {
    const text = yield* read(file);
    if (text === null) continue;
    for (const raw of parse(text)) {
      const candidate = toCandidate(source, raw);
      if (candidate === null) continue;
      const key = `${source}\0${candidate.server.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
});
