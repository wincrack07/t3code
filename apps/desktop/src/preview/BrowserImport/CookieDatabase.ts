import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

export interface ImportedCookie {
  readonly url: string;
  readonly name: string;
  readonly value: string;
  /** Leave host-only cookies undefined; Electron widens any supplied domain and rejects __Host- cookies with one. */
  readonly domain: string | undefined;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly expirationDate: number | undefined;
  readonly sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface CookieReadResult {
  readonly cookies: ReadonlyArray<ImportedCookie>;
  readonly undecryptable: number;
  readonly undecryptableHosts: ReadonlyArray<string>;
  /** The share of `undecryptable` that was skipped for being partitioned, not for failing to decrypt. */
  readonly partitioned?: number;
  readonly partitionedHosts?: ReadonlyArray<string>;
  readonly decryptFailedHosts?: ReadonlyArray<string>;
}

export const cookieScope = (
  host: string,
  path: string,
  secure: boolean,
): { readonly url: string; readonly domain: string | undefined } => {
  const isDomainCookie = host.startsWith(".");
  const unwrappedHost = bareHost(host);
  const authority =
    unwrappedHost.includes(":") && !(unwrappedHost.startsWith("[") && unwrappedHost.endsWith("]"))
      ? `[${unwrappedHost}]`
      : unwrappedHost;
  return {
    url: `${secure ? "https" : "http"}://${authority}${path}`,
    domain: isDomainCookie ? host : undefined,
  };
};

export const bareHost = (host: string): string => (host.startsWith(".") ? host.slice(1) : host);

const vacuumInto = Effect.fn("CookieDatabase.vacuumInto")(function* (
  filename: string,
  target: string,
) {
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`VACUUM INTO ${target}`;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
});

const SIDECAR_SUFFIXES = ["-wal", "-journal"];

/**
 * Copies the files and reads only the copy, so SQLite never takes a lock on a database its browser
 * may be writing. Opening the copy read-write lets SQLite replay a journal the copy caught mid-write.
 */
export const snapshotCookieDatabase = Effect.fn("CookieDatabase.snapshotCookieDatabase")(function* (
  cookiePath: string,
  tempPrefix = "t3code-cookie-import-",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: tempPrefix });
  const target = path.join(directory, path.basename(cookiePath));
  const copy = `${target}.copy`;
  yield* fileSystem.copyFile(cookiePath, copy);
  yield* Effect.forEach(SIDECAR_SUFFIXES, (suffix) =>
    fileSystem.copyFile(`${cookiePath}${suffix}`, `${copy}${suffix}`).pipe(Effect.ignore),
  );
  yield* vacuumInto(copy, target);
  return target;
});
