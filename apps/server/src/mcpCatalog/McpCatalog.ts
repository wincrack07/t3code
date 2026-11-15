import {
  McpCatalogError,
  McpCatalogServer,
  type McpCatalogImportCandidate,
  type McpCatalogImportInput,
  type McpCatalogServerStatus,
  type McpCatalogSnapshot,
  type McpCatalogUpsertInput,
  type McpCatalogVariable,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { McpClient, McpProtocol, type McpSchema } from "effect/ai";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as HostProcess from "@t3tools/shared/HostProcess";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { readImportCandidates } from "./McpCatalogImport.ts";

const CatalogFile = Schema.Struct({
  version: Schema.Literal(1),
  servers: Schema.Array(McpCatalogServer),
});
const decodeCatalogFile = Schema.decodeUnknownEffect(Schema.fromJsonString(CatalogFile));
const encodeCatalogFile = Schema.encodeEffect(Schema.fromJsonString(CatalogFile));

/** Secret variable values, kept in the secret store by variable name. */
const SecretValues = Schema.Struct({
  env: Schema.Record(Schema.String, Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
});
type SecretValues = typeof SecretValues.Type;
const decodeSecretValues = Schema.decodeUnknownEffect(Schema.fromJsonString(SecretValues));
const encodeSecretValues = Schema.encodeEffect(Schema.fromJsonString(SecretValues));
const NO_SECRETS: SecretValues = { env: {}, headers: {} };

const CONNECT_TIMEOUT = "45 seconds";
const REQUEST_TIMEOUT = "60 seconds";
const CALL_TIMEOUT = "15 minutes";
const MAX_DESCRIPTION_CHARS = 1_000;
const MAX_SEARCH_RESULTS = 8;

export interface CatalogToolMatch {
  readonly server: string;
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly inputSchema: unknown;
}

export interface CatalogServerSummary {
  readonly id: string;
  readonly name: string;
  readonly state: McpCatalogServerStatus["state"];
  readonly error: string | null;
  readonly tools: ReadonlyArray<string>;
}

export interface ResolvedCatalogTool {
  readonly server: string;
  readonly tool: McpSchema.Tool;
  readonly readOnly: boolean;
}

interface Live {
  readonly client: McpClient.McpClient;
  readonly scope: Scope.Closeable;
  readonly tools: ReadonlyArray<McpSchema.Tool>;
}

interface Entry {
  readonly server: McpCatalogServer;
  readonly secrets: SecretValues;
  readonly status: McpCatalogServerStatus;
  readonly live: Live | undefined;
  readonly lock: Semaphore.Semaphore;
}

export class McpCatalog extends Context.Service<
  McpCatalog,
  {
    /** The current catalog, then every change. Subscribing connects enabled servers. */
    readonly changes: Stream.Stream<McpCatalogSnapshot>;
    readonly snapshot: Effect.Effect<McpCatalogSnapshot>;
    readonly upsert: (
      input: McpCatalogUpsertInput,
    ) => Effect.Effect<McpCatalogSnapshot, McpCatalogError>;
    readonly remove: (id: string) => Effect.Effect<McpCatalogSnapshot, McpCatalogError>;
    readonly reconnect: (id: string) => Effect.Effect<McpCatalogSnapshot, McpCatalogError>;
    readonly importCandidates: Effect.Effect<
      ReadonlyArray<McpCatalogImportCandidate>,
      McpCatalogError
    >;
    readonly importServers: (
      input: McpCatalogImportInput,
    ) => Effect.Effect<McpCatalogSnapshot, McpCatalogError>;
    /** Every enabled server with its tool names, connecting each as needed. */
    readonly listServers: Effect.Effect<ReadonlyArray<CatalogServerSummary>>;
    readonly search: (input: {
      readonly query: string;
      readonly server?: string | undefined;
    }) => Effect.Effect<
      {
        readonly tools: ReadonlyArray<CatalogToolMatch>;
        readonly unavailable: ReadonlyArray<{ readonly server: string; readonly error: string }>;
      },
      McpCatalogError
    >;
    readonly resolveTool: (
      server: string,
      tool: string,
    ) => Effect.Effect<ResolvedCatalogTool, McpCatalogError>;
    readonly callTool: (
      resolved: ResolvedCatalogTool,
      args: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<McpSchema.CallToolResult, McpCatalogError>;
  }
>()("t3/mcpCatalog/McpCatalog") {}

const failure = (message: string) => new McpCatalogError({ message });

const describe = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { readonly message: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message.trim();
  }
  return "The server could not be reached.";
};

/** Why a server would not connect, in terms of what the user configured. */
const connectionError = (server: McpCatalogServer, cause: unknown) => {
  const message = describe(cause);
  return server.transport.type === "stdio" && /spawn/iu.test(message)
    ? `Could not start \`${server.transport.command}\`. Check that it is installed on this machine.`
    : message;
};

const statusOf = (
  server: McpCatalogServer,
  state: McpCatalogServerStatus["state"] = server.enabled ? "idle" : "disabled",
): McpCatalogServerStatus => ({
  id: server.id,
  state,
  error: null,
  tools: [],
  serverVersion: null,
});

const toolSummary = (tool: McpSchema.Tool) => ({
  name: tool.name,
  description: (tool.description ?? tool.title ?? "").slice(0, MAX_DESCRIPTION_CHARS),
  readOnly: tool.annotations?.readOnlyHint === true,
});

/** What clients see: secret values stay here. */
const redact = (server: McpCatalogServer, secrets: SecretValues): McpCatalogServer => {
  const hide = (variables: ReadonlyArray<McpCatalogVariable>, stored: Record<string, string>) =>
    variables.map((variable) =>
      variable.secret
        ? {
            name: variable.name,
            value: "",
            secret: true,
            stored: stored[variable.name] !== undefined,
          }
        : { name: variable.name, value: variable.value, secret: false },
    );
  return {
    ...server,
    env: hide(server.env, secrets.env),
    headers: hide(server.headers, secrets.headers),
  };
};

/** The values a connection uses, secrets included. */
const resolvedValues = (
  variables: ReadonlyArray<McpCatalogVariable>,
  stored: Record<string, string>,
) =>
  Object.fromEntries(
    variables.map((variable) => [
      variable.name,
      variable.secret ? (stored[variable.name] ?? "") : variable.value,
    ]),
  );

const scoreTool = (
  server: McpCatalogServer,
  tool: McpSchema.Tool,
  terms: ReadonlyArray<string>,
) => {
  const name = tool.name.toLowerCase();
  const description = `${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
  const serverText = `${server.id} ${server.name}`.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (term === name) total += 100;
    else if (name.includes(term)) total += 3;
    else if (description.includes(term)) total += 1;
    if (serverText.includes(term)) total += 2;
  }
  return total;
};

const validateServer = (server: McpCatalogServer): string | null => {
  if (server.transport.type === "http") {
    let url: URL;
    try {
      url = new URL(server.transport.url);
    } catch {
      return "Enter a full URL, such as https://example.com/mcp.";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "The URL must start with https:// or http://.";
    }
  }
  const names = (variables: ReadonlyArray<McpCatalogVariable>) =>
    new Set(variables.map((variable) => variable.name)).size === variables.length;
  if (!names(server.env)) return "Each environment variable needs its own name.";
  if (!names(server.headers)) return "Each header needs its own name.";
  return null;
};

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const httpClient = yield* HttpClient.HttpClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const serviceScope = yield* Effect.scope;
  const catalogPath = path.join(config.stateDir, "mcp-catalog.json");
  const secretName = (id: string) => `mcp-catalog-${id}`;
  // Catalog edits run one at a time; each server's connection has its own lock.
  const editLock = yield* Semaphore.make(1);

  const readSecrets = (id: string) =>
    secretStore.get(secretName(id)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(NO_SECRETS),
          onSome: (bytes) => decodeSecretValues(new TextDecoder().decode(bytes)),
        }),
      ),
      Effect.orElseSucceed(() => NO_SECRETS),
    );

  const writeSecrets = (id: string, secrets: SecretValues) =>
    Object.keys(secrets.env).length === 0 && Object.keys(secrets.headers).length === 0
      ? secretStore.remove(secretName(id)).pipe(Effect.ignore)
      : encodeSecretValues(secrets).pipe(
          Effect.flatMap((json) => secretStore.set(secretName(id), new TextEncoder().encode(json))),
          Effect.mapError(() => failure("The server's secrets could not be saved.")),
        );

  const loaded = yield* fileSystem.readFileString(catalogPath).pipe(
    Effect.flatMap(decodeCatalogFile),
    Effect.map((file) => file.servers),
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed([])
          : Effect.logWarning("Could not read the MCP catalog.", error).pipe(Effect.as([])),
      SchemaError: (error) =>
        Effect.logWarning("Could not decode the MCP catalog.", error).pipe(Effect.as([])),
    }),
  );
  const initial = new Map<string, Entry>();
  for (const server of loaded) {
    initial.set(server.id, {
      server,
      secrets: yield* readSecrets(server.id),
      status: statusOf(server),
      live: undefined,
      lock: yield* Semaphore.make(1),
    });
  }
  let entries = initial;

  const snapshotOf = (): McpCatalogSnapshot => {
    const list = [...entries.values()];
    return {
      servers: list.map((entry) => redact(entry.server, entry.secrets)),
      statuses: list.map((entry) => entry.status),
    };
  };
  const snapshots = yield* SubscriptionRef.make(snapshotOf());
  const publish = Effect.suspend(() => SubscriptionRef.set(snapshots, snapshotOf()));
  const currentSnapshot = Effect.sync(snapshotOf);

  const setEntry = (id: string, update: (entry: Entry) => Entry) =>
    Effect.suspend(() => {
      const entry = entries.get(id);
      if (entry === undefined) return Effect.void;
      entries = new Map(entries).set(id, update(entry));
      return publish;
    });

  const persist = Effect.suspend(() => {
    const servers = [...entries.values()].map((entry) => ({
      ...entry.server,
      // The file keeps secret names only; values live in the secret store.
      env: entry.server.env.map((variable) =>
        variable.secret ? { name: variable.name, value: "", secret: true } : variable,
      ),
      headers: entry.server.headers.map((variable) =>
        variable.secret ? { name: variable.name, value: "", secret: true } : variable,
      ),
    }));
    return encodeCatalogFile({ version: 1, servers }).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({ filePath: catalogPath, contents }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.mapError(() => failure("The MCP catalog could not be saved.")),
    );
  });

  const closeLive = (live: Live | undefined) =>
    live === undefined ? Effect.void : Scope.close(live.scope, Exit.void);

  const open = Effect.fn("McpCatalog.open")(
    function* (server: McpCatalogServer, secrets: SecretValues) {
      const scope = yield* Scope.make();
      const connected = yield* Effect.gen(function* () {
        const transport =
          server.transport.type === "stdio"
            ? yield* McpClient.stdio({
                command: ChildProcess.make(server.transport.command, server.transport.args, {
                  ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
                  env: resolvedValues(server.env, secrets.env),
                  extendEnv: true,
                }),
                protocol: McpProtocol.v2025_11_25,
              })
            : yield* McpClient.http({
                url: server.transport.url,
                headers: resolvedValues(server.headers, secrets.headers),
                protocol: McpProtocol.v2025_11_25,
              });
        const client = yield* McpClient.make({
          name: "T3 Code",
          version: packageJson.version,
          timeout: REQUEST_TIMEOUT,
        }).pipe(Effect.provideService(McpClient.Transport, transport));
        const tools = yield* client.listTools();
        return { client, tools, scope } satisfies Live;
      }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.timeoutOrElse({
          duration: CONNECT_TIMEOUT,
          orElse: () => Effect.fail(failure("The server did not answer within 45 seconds.")),
        }),
        Effect.exit,
      );
      if (Exit.isFailure(connected)) {
        yield* Scope.close(scope, Exit.void);
        return yield* Effect.failCause(connected.cause);
      }
      return connected.value;
    },
    (effect, server) => Effect.mapError(effect, (cause) => failure(connectionError(server, cause))),
  );

  /** The server's live connection, opening it when there is none. */
  const connection = (id: string) =>
    Effect.suspend(() => {
      const entry = entries.get(id);
      if (entry === undefined) return Effect.fail(failure(`No MCP server named \`${id}\`.`));
      return entry.lock.withPermits(1)(
        Effect.gen(function* () {
          const current = entries.get(id);
          if (current === undefined) return yield* failure(`No MCP server named \`${id}\`.`);
          if (!current.server.enabled) {
            return yield* failure(`The MCP server \`${id}\` is turned off in Settings.`);
          }
          if (current.live !== undefined) return current.live;
          yield* setEntry(id, (value) => ({
            ...value,
            status: { ...value.status, state: "connecting", error: null },
          }));
          const opened = yield* open(current.server, current.secrets).pipe(Effect.exit);
          // An edit or removal while this connected replaced the entry; drop this connection.
          if (entries.get(id)?.server !== current.server) {
            if (Exit.isSuccess(opened)) yield* closeLive(opened.value);
            return yield* failure(
              `The MCP server \`${id}\` changed while it connected. Try again.`,
            );
          }
          if (Exit.isFailure(opened)) {
            const error = Option.getOrUndefined(Exit.findErrorOption(opened));
            yield* setEntry(id, (value) => ({
              ...value,
              status: { ...value.status, state: "error", error: error?.message ?? null, tools: [] },
            }));
            return yield* Effect.failCause(opened.cause);
          }
          const live = opened.value;
          yield* setEntry(id, (value) => ({
            ...value,
            live,
            status: {
              id,
              state: "connected",
              error: null,
              tools: live.tools.map(toolSummary),
              serverVersion: live.client.serverInfo?.version ?? null,
            },
          }));
          return live;
        }),
      );
    });

  /** Forgets a connection that failed mid-call, so the next use reconnects. */
  const dropConnection = Effect.fn("McpCatalog.dropConnection")(function* (
    id: string,
    live: Live,
    error: string,
  ) {
    if (entries.get(id)?.live !== live) return;
    yield* setEntry(id, (value) => ({
      ...value,
      live: undefined,
      status: { ...value.status, state: "error", error },
    }));
    yield* closeLive(live);
  });

  const connectEnabledInBackground = Effect.suspend(() =>
    Effect.forEach(
      [...entries.values()].filter(
        (entry) =>
          entry.server.enabled && entry.live === undefined && entry.status.state === "idle",
      ),
      (entry) => connection(entry.server.id).pipe(Effect.ignore, Effect.forkIn(serviceScope)),
      { discard: true },
    ),
  );

  const replace = Effect.fn("McpCatalog.replace")(function* (input: {
    readonly previousId: string | undefined;
    readonly server: McpCatalogServer;
    readonly secrets: SecretValues;
  }) {
    const previous = input.previousId === undefined ? undefined : entries.get(input.previousId);
    const entry: Entry = {
      server: input.server,
      secrets: input.secrets,
      status: statusOf(input.server),
      live: undefined,
      lock: previous?.lock ?? (yield* Semaphore.make(1)),
    };
    // An edit keeps the server where it was in the list.
    entries =
      previous === undefined
        ? new Map(entries).set(input.server.id, entry)
        : new Map(
            [...entries].map(([id, current]): [string, Entry] =>
              id === input.previousId ? [input.server.id, entry] : [id, current],
            ),
          );
    yield* closeLive(previous?.live);
    if (input.previousId !== undefined && input.previousId !== input.server.id) {
      yield* secretStore.remove(secretName(input.previousId)).pipe(Effect.ignore);
    }
    yield* writeSecrets(input.server.id, input.secrets);
  });

  const upsert = Effect.fn("McpCatalog.upsert")(function* (input: McpCatalogUpsertInput) {
    return yield* editLock.withPermits(1)(
      Effect.gen(function* () {
        const invalid = validateServer(input.server);
        if (invalid !== null) return yield* failure(invalid);
        const previousId = input.previousId ?? input.server.id;
        const previous = entries.get(previousId);
        if (input.server.id !== previousId && entries.has(input.server.id)) {
          return yield* failure(`A server named \`${input.server.id}\` already exists.`);
        }
        if (input.previousId !== undefined && previous === undefined) {
          return yield* failure(`No MCP server named \`${input.previousId}\`.`);
        }
        const kept = previous?.secrets ?? NO_SECRETS;
        // A blank secret that was stored before keeps its stored value.
        const secretsFor = (
          variables: ReadonlyArray<McpCatalogVariable>,
          stored: Record<string, string>,
        ) =>
          Object.fromEntries(
            variables.flatMap((variable) => {
              if (!variable.secret) return [];
              if (variable.value !== "") return [[variable.name, variable.value]];
              const value = stored[variable.name];
              return value === undefined ? [] : [[variable.name, value]];
            }),
          );
        const secrets = {
          env: secretsFor(input.server.env, kept.env),
          headers: secretsFor(input.server.headers, kept.headers),
        };
        const strip = (variables: ReadonlyArray<McpCatalogVariable>) =>
          variables.map((variable) =>
            variable.secret
              ? { name: variable.name, value: "", secret: true }
              : { name: variable.name, value: variable.value, secret: false },
          );
        const server = {
          ...input.server,
          env: strip(input.server.env),
          headers: strip(input.server.headers),
        };
        yield* replace({
          previousId: previous === undefined ? undefined : previousId,
          server,
          secrets,
        });
        yield* persist;
        yield* publish;
        yield* connectEnabledInBackground;
        return snapshotOf();
      }),
    );
  });

  const remove = Effect.fn("McpCatalog.remove")(function* (id: string) {
    return yield* editLock.withPermits(1)(
      Effect.gen(function* () {
        const entry = entries.get(id);
        if (entry === undefined) return snapshotOf();
        const next = new Map(entries);
        next.delete(id);
        entries = next;
        yield* closeLive(entry.live);
        yield* secretStore.remove(secretName(id)).pipe(Effect.ignore);
        yield* persist;
        yield* publish;
        return snapshotOf();
      }),
    );
  });

  const reconnect = Effect.fn("McpCatalog.reconnect")(function* (id: string) {
    const entry = entries.get(id);
    if (entry === undefined) return yield* failure(`No MCP server named \`${id}\`.`);
    yield* entry.lock.withPermits(1)(
      Effect.gen(function* () {
        const current = entries.get(id);
        if (current === undefined) return;
        yield* closeLive(current.live);
        yield* setEntry(id, (value) => ({
          ...value,
          live: undefined,
          status: statusOf(value.server),
        }));
      }),
    );
    yield* connection(id).pipe(Effect.ignore);
    return snapshotOf();
  });

  /** Every config file a CLI keeps MCP servers in, including other accounts' folders. */
  const candidatesOnDisk = Effect.gen(function* () {
    const instances = yield* settings.getSettings.pipe(
      Effect.map((current) => Object.values(current.providerInstances)),
      Effect.orElseSucceed(() => []),
    );
    const homesFor = (driver: string) =>
      instances.flatMap((instance) => {
        if (instance.driver !== driver) return [];
        const config = instance.config;
        const homePath =
          typeof config === "object" && config !== null && "homePath" in config
            ? config.homePath
            : undefined;
        if (typeof homePath !== "string" || homePath.trim() === "") return [];
        const trimmed = homePath.trim();
        return [trimmed.startsWith("~/") ? path.join(home, trimmed.slice(2)) : trimmed];
      });
    return yield* readImportCandidates({
      home,
      platform,
      environment,
      claudeConfigDirs: homesFor("claudeAgent"),
      codexHomes: homesFor("codex"),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  });

  const importCandidates = Effect.fn("McpCatalog.importCandidates")(function* () {
    const candidates = yield* candidatesOnDisk;
    return candidates.map((candidate) => ({
      source: candidate.source,
      server: redact(candidate.server, candidate.secrets),
      exists: entries.has(candidate.server.id),
    }));
  });

  const importServers = Effect.fn("McpCatalog.importServers")(function* (
    input: McpCatalogImportInput,
  ) {
    const candidates = yield* candidatesOnDisk;
    return yield* editLock.withPermits(1)(
      Effect.gen(function* () {
        for (const item of input.items) {
          const candidate = candidates.find(
            (found) => found.source === item.source && found.server.id === item.id,
          );
          if (candidate === undefined || entries.has(candidate.server.id)) continue;
          if (validateServer(candidate.server) !== null) continue;
          yield* replace({
            previousId: undefined,
            server: candidate.server,
            secrets: candidate.secrets,
          });
        }
        yield* persist;
        yield* publish;
        yield* connectEnabledInBackground;
        return snapshotOf();
      }),
    );
  });

  const enabledIds = () =>
    [...entries.values()].filter((entry) => entry.server.enabled).map((entry) => entry.server.id);

  /** Connects the servers concurrently; each one's failure is reported, not thrown. */
  const connectAll = (ids: ReadonlyArray<string>) =>
    Effect.forEach(
      ids,
      (id) =>
        connection(id).pipe(
          Effect.map((live) => ({ id, live, error: null })),
          Effect.catch((error) => Effect.succeed({ id, live: undefined, error: error.message })),
        ),
      { concurrency: "unbounded" },
    );

  const listServers = Effect.gen(function* () {
    const results = yield* connectAll(enabledIds());
    return results.flatMap(({ id, live, error }) => {
      const entry = entries.get(id);
      if (entry === undefined) return [];
      return [
        {
          id,
          name: entry.server.name,
          state: entry.status.state,
          error,
          tools: live?.tools.map((tool) => tool.name) ?? [],
        },
      ];
    });
  }).pipe(Effect.withSpan("McpCatalog.listServers"));

  const search = Effect.fn("McpCatalog.search")(function* (input: {
    readonly query: string;
    readonly server?: string | undefined;
  }) {
    if (input.server !== undefined && !entries.has(input.server)) {
      return yield* failure(
        `No MCP server named \`${input.server}\`. Servers: ${enabledIds().join(", ") || "none"}.`,
      );
    }
    const terms = input.query
      .toLowerCase()
      .split(/[^a-z0-9_]+/u)
      .filter(Boolean);
    const results = yield* connectAll(input.server === undefined ? enabledIds() : [input.server]);
    const scored = results.flatMap(({ id, live }) => {
      const entry = entries.get(id);
      if (live === undefined || entry === undefined) return [];
      return live.tools.map((tool) => ({
        score: terms.length === 0 ? 1 : scoreTool(entry.server, tool, terms),
        match: {
          server: id,
          name: tool.name,
          description: (tool.description ?? tool.title ?? "").slice(0, MAX_DESCRIPTION_CHARS),
          readOnly: tool.annotations?.readOnlyHint === true,
          inputSchema: tool.inputSchema,
        },
      }));
    });
    return {
      tools: scored
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SEARCH_RESULTS)
        .map((candidate) => candidate.match),
      unavailable: results.flatMap(({ id, error }) =>
        error === null ? [] : [{ server: id, error }],
      ),
    };
  });

  const resolveTool = Effect.fn("McpCatalog.resolveTool")(function* (
    server: string,
    toolName: string,
  ) {
    const live = yield* connection(server);
    const tool = live.tools.find((candidate) => candidate.name === toolName);
    if (tool === undefined) {
      const names = live.tools.map((candidate) => candidate.name);
      return yield* failure(
        `\`${server}\` has no tool named \`${toolName}\`. Its tools: ${names.join(", ") || "none"}.`,
      );
    }
    return { server, tool, readOnly: tool.annotations?.readOnlyHint === true };
  });

  const callTool = Effect.fn("McpCatalog.callTool")(function* (
    resolved: ResolvedCatalogTool,
    args: Readonly<Record<string, unknown>>,
  ) {
    const live = yield* connection(resolved.server);
    return yield* live.client
      .callTool({ tool: resolved.tool, arguments: args }, { timeout: CALL_TIMEOUT })
      .pipe(
        Effect.catch((error) =>
          dropConnection(resolved.server, live, error.message).pipe(
            Effect.andThen(Effect.fail(failure(describe(error)))),
          ),
        ),
      );
  });

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...entries.values()], (entry) => closeLive(entry.live), { discard: true }),
  );

  return McpCatalog.of({
    changes: Stream.unwrap(
      connectEnabledInBackground.pipe(Effect.as(SubscriptionRef.changes(snapshots))),
    ),
    snapshot: currentSnapshot,
    upsert,
    remove,
    reconnect,
    importCandidates: importCandidates(),
    importServers,
    listServers,
    search,
    resolveTool,
    callTool,
  });
});

export const layer = Layer.effect(McpCatalog, make);
