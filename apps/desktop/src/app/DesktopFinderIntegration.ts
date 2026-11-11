// @effect-diagnostics nodeBuiltinImport:off -- Automator bundles and bounded local file reads are macOS adapter work.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES, type DesktopFinderItem } from "@t3tools/contracts";
import { readFinderLink } from "@t3tools/shared/finderIntegration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { getDesktopScheme } from "../electron/ElectronProtocol.ts";
import { finderWorkflow } from "./FinderWorkflow.ts";

async function inspectFinderPaths(url: string): Promise<DesktopFinderItem[]> {
  const paths = readFinderLink(url);
  if (!paths) throw new Error("Invalid Finder selection.");
  return Promise.all(
    paths.map(async (path) => {
      const canonical = await NodeFSP.realpath(path);
      const stat = await NodeFSP.stat(canonical);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported item: ${path}`);
      return {
        id: NodeCrypto.randomUUID(),
        path: canonical,
        name: NodePath.basename(canonical),
        kind: stat.isDirectory() ? ("folder" as const) : ("file" as const),
        sizeBytes: stat.size,
      };
    }),
  );
}

export function makeFinderAdapter(input: {
  homeDirectory: string;
  appBundle: string;
  supported: boolean;
  scheme: string;
}) {
  const root = NodePath.join(
    input.homeDirectory,
    "Library",
    "Services",
    "Send to T3 Code.workflow",
  );
  const marker = NodePath.join(root, "Contents", "t3code-owner");
  const allowed = new Map<string, DesktopFinderItem>();
  const requireSupported = () => {
    if (!input.supported) throw new Error("Finder integration requires the packaged macOS app.");
  };
  const owned = async () => {
    try {
      return (await NodeFSP.readFile(marker, "utf8")) === "t3code-finder-v1\n";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  const state = async () => ({
    supported: input.supported,
    installed: input.supported && (await owned()),
  });
  return {
    state,
    async setInstalled(install: boolean) {
      requireSupported();
      if (
        (await NodeFSP.lstat(root).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )) &&
        !(await owned())
      )
        throw new Error("A different workflow already uses this name. Move it before installing.");
      if (!install) {
        await NodeFSP.rm(root, { recursive: true, force: true });
        return state();
      }
      const workflow = finderWorkflow(input.appBundle, input.scheme);
      const staging = `${root}.${NodeCrypto.randomUUID()}`;
      try {
        await NodeFSP.mkdir(NodePath.join(staging, "Contents"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(staging, "Contents", "Info.plist"), workflow.info);
        await NodeFSP.writeFile(
          NodePath.join(staging, "Contents", "document.wflow"),
          workflow.document,
        );
        await NodeFSP.writeFile(
          NodePath.join(staging, "Contents", "t3code-owner"),
          "t3code-finder-v1\n",
        );
        await NodeFSP.rm(root, { recursive: true, force: true });
        await NodeFSP.rename(staging, root);
      } finally {
        await NodeFSP.rm(staging, { recursive: true, force: true });
      }
      return state();
    },
    async inspect(url: string) {
      requireSupported();
      const items = await inspectFinderPaths(url);
      // Only the most recent selection can be read; paths never come from a renderer read request.
      allowed.clear();
      for (const item of items) allowed.set(item.id, item);
      return items;
    },
    async read(id: string) {
      requireSupported();
      const item = allowed.get(id);
      if (!item || item.kind !== "file")
        throw new Error("This Finder selection is no longer available. Send it again from Finder.");
      allowed.delete(id);
      const handle = await NodeFSP.open(item.path, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 0 || stat.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES)
          throw new Error(`${item.name} must be a nonempty file of at most 50 MiB.`);
        const buffer = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
          if (bytesRead === 0) break;
          length += bytesRead;
        }
        if (length > stat.size)
          throw new Error(`${item.name} changed while being read. Try again.`);
        return new Uint8Array(buffer.subarray(0, length));
      } finally {
        await handle.close();
      }
    },
  };
}

class FinderIntegrationError extends Schema.TaggedError<FinderIntegrationError>()(
  "FinderIntegrationError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : "Finder integration failed.";
  }
}
const attempt = Effect.fn("DesktopFinderIntegration.filesystem")(<A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new FinderIntegrationError({ cause }) }),
);
export class DesktopFinderIntegration extends Context.Service<
  DesktopFinderIntegration,
  {
    readonly state: Effect.Effect<
      { supported: boolean; installed: boolean },
      FinderIntegrationError
    >;
    readonly setInstalled: (
      installed: boolean,
    ) => Effect.Effect<{ supported: boolean; installed: boolean }, FinderIntegrationError>;
    readonly inspect: (url: string) => Effect.Effect<DesktopFinderItem[], FinderIntegrationError>;
    readonly read: (id: string) => Effect.Effect<Uint8Array, FinderIntegrationError>;
  }
>()("@t3tools/desktop/app/DesktopFinderIntegration") {}
export const layer = Layer.effect(
  DesktopFinderIntegration,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment.DesktopEnvironment;
    const adapter = makeFinderAdapter({
      homeDirectory: env.homeDirectory,
      appBundle: NodePath.resolve(env.appPath, "../../.."),
      supported: env.platform === "darwin" && env.isPackaged,
      scheme: getDesktopScheme(env.isDevelopment),
    });
    return DesktopFinderIntegration.of({
      state: attempt(adapter.state),
      setInstalled: Effect.fn("DesktopFinderIntegration.setInstalled")((installed) =>
        attempt(() => adapter.setInstalled(installed)),
      ),
      inspect: Effect.fn("DesktopFinderIntegration.inspect")((url) =>
        attempt(() => adapter.inspect(url)),
      ),
      read: Effect.fn("DesktopFinderIntegration.read")((id) => attempt(() => adapter.read(id))),
    });
  }),
);
