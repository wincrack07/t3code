import type {
  BrowserExtension,
  BrowserExtensionInstallInput,
  BrowserExtensionInstallResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { BrowserWindow, net, type Session } from "electron";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as BrowserSession from "../BrowserSession.ts";
import {
  chromiumExtensionId,
  crxPublicKeyForId,
  crxZipPayload,
  parseWebStoreReference,
  summarizeManifest,
  unpackZip,
  webStoreDownloadUrl,
  type ExtensionManifestSummary,
} from "./Package.ts";

const InstalledExtension = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  source: Schema.Literals(["webStore", "unpacked"]),
  enabled: Schema.Boolean,
  name: Schema.String,
  version: Schema.String,
  popup: Schema.optional(Schema.String),
});
type InstalledExtension = typeof InstalledExtension.Type;

const Registry = Schema.fromJsonString(Schema.Array(InstalledExtension));
const decodeRegistry = Schema.decodeEffect(Registry);
const encodeRegistry = Schema.encodeEffect(Registry);

export class BrowserExtensionError extends Schema.TaggedError<BrowserExtensionError>()(
  "BrowserExtensionError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class BrowserExtensions extends Context.Service<
  BrowserExtensions,
  {
    readonly list: Effect.Effect<ReadonlyArray<BrowserExtension>>;
    /** Always ends in a native confirmation that lists the extension's permissions. */
    readonly install: (
      input: BrowserExtensionInstallInput,
    ) => Effect.Effect<BrowserExtensionInstallResult>;
    readonly setEnabled: (
      id: string,
      enabled: boolean,
    ) => Effect.Effect<void, BrowserExtensionError>;
    readonly remove: (id: string) => Effect.Effect<void, BrowserExtensionError>;
    readonly openPopup: (
      session: Session,
      id: string,
    ) => Effect.Effect<void, BrowserExtensionError>;
  }
>()("@t3tools/desktop/preview/BrowserExtensions/BrowserExtensions") {}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const toError = (cause: unknown) => new BrowserExtensionError({ message: messageOf(cause), cause });

const attempt = <A>(run: () => A) => Effect.try({ try: run, catch: toError });

const JsonText = Schema.fromJsonString(Schema.Unknown);
const decodeJsonText = Schema.decodeEffect(JsonText);
const encodeJsonText = Schema.encodeEffect(JsonText);
const decodeJson = (text: string) => decodeJsonText(text).pipe(Effect.mapError(toError));

const failedInstall = <A, E, R>(
  install: Effect.Effect<A, E, R>,
): Effect.Effect<A | BrowserExtensionInstallResult, never, R> =>
  install.pipe(
    Effect.catch((cause) =>
      Effect.succeed({ status: "failed", message: messageOf(cause) } as const),
    ),
  );

const make = Effect.gen(function* BrowserExtensionsMake() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const dialog = yield* ElectronDialog.ElectronDialog;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const browserSession = yield* BrowserSession.BrowserSession;

  const registryPath = path.join(environment.stateDir, "browser-extensions.json");
  const storeRoot = path.join(environment.stateDir, "browser-extensions");

  const initial = yield* fileSystem.readFileString(registryPath).pipe(
    Effect.flatMap(decodeRegistry),
    Effect.orElseSucceed((): ReadonlyArray<InstalledExtension> => []),
  );
  const registryRef = yield* SynchronizedRef.make(initial);
  const sessions = new Set<Session>();
  const loadErrors = new Map<string, string>();

  const persist = (registry: ReadonlyArray<InstalledExtension>) =>
    encodeRegistry(registry).pipe(
      Effect.flatMap((json) => fileSystem.writeFileString(registryPath, json)),
      Effect.mapError(
        (cause) => new BrowserExtensionError({ message: "Could not save extensions.", cause }),
      ),
    );

  // Matched by folder: Electron derives an unpacked extension's id itself.
  const loadedIn = (target: Session, extension: InstalledExtension) =>
    target.extensions.getAllExtensions().find((loaded) => loaded.path === extension.path);

  const loadInto = (target: Session, extension: InstalledExtension): Promise<void> =>
    loadedIn(target, extension)
      ? Promise.resolve()
      : target.extensions.loadExtension(extension.path).then(
          () => void loadErrors.delete(extension.id),
          (cause: unknown) => void loadErrors.set(extension.id, messageOf(cause)),
        );

  const unloadEverywhere = (extension: InstalledExtension) => {
    for (const target of sessions) {
      const loaded = loadedIn(target, extension);
      if (loaded) target.extensions.removeExtension(loaded.id);
    }
  };

  // Electron forgets extensions on quit, so every persistent session reloads the enabled ones.
  yield* browserSession.onPersistentSession((target) => {
    sessions.add(target);
    for (const extension of SynchronizedRef.getUnsafe(registryRef)) {
      if (extension.enabled) void loadInto(target, extension);
    }
  });

  const toContract = (extension: InstalledExtension): BrowserExtension => {
    const loadError = loadErrors.get(extension.id);
    return {
      id: extension.id,
      name: extension.name,
      version: extension.version,
      source: extension.source,
      enabled: extension.enabled,
      hasPopup: extension.popup !== undefined,
      ...(loadError === undefined ? {} : { loadError }),
    };
  };

  const readSummary = Effect.fnUntraced(function* (directory: string) {
    const manifest = yield* fileSystem.readFileString(path.join(directory, "manifest.json"));
    const parsed = yield* decodeJson(manifest);
    const locale =
      typeof parsed === "object" && parsed !== null && "default_locale" in parsed
        ? String(parsed.default_locale)
        : undefined;
    const messages =
      locale === undefined
        ? undefined
        : yield* fileSystem
            .readFileString(path.join(directory, "_locales", locale, "messages.json"))
            .pipe(
              Effect.flatMap(decodeJson),
              Effect.map((messages) =>
                typeof messages === "object" && messages !== null && !Array.isArray(messages)
                  ? (messages as Readonly<Record<string, unknown>>)
                  : undefined,
              ),
              Effect.orElseSucceed(() => undefined),
            );
    return { manifest: parsed, summary: yield* attempt(() => summarizeManifest(parsed, messages)) };
  });

  const confirm = Effect.fnUntraced(function* (summary: ExtensionManifestSummary, origin: string) {
    const owner = Option.getOrUndefined(yield* electronWindow.focusedMainOrFirst);
    const lines = [
      origin,
      "",
      summary.permissions.length === 0
        ? "It asks for no special permissions."
        : `It can use:\n${summary.permissions.map((permission) => `• ${permission}`).join("\n")}`,
      ...(summary.unsupported.length === 0
        ? []
        : [
            "",
            `T3 Code's browser engine (Electron) does not document support for ${summary.unsupported.join(", ")}. Features that need them may not work.`,
          ]),
      "",
      "It applies to every saved browser profile, but not to incognito.",
    ];
    const { response } = yield* dialog.showMessageBox(
      {
        type: "question",
        buttons: ["Add extension", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: `Add “${summary.name}” ${summary.version}?`,
        detail: lines.join("\n"),
      },
      owner,
    );
    return response === 0;
  });

  const register = Effect.fnUntraced(function* (extension: InstalledExtension) {
    yield* SynchronizedRef.updateEffect(registryRef, (registry) => {
      const next = [...registry.filter((entry) => entry.id !== extension.id), extension];
      return persist(next).pipe(Effect.as(next));
    });
    unloadEverywhere(extension);
    yield* Effect.promise(() =>
      Promise.all([...sessions].map((target) => loadInto(target, extension))),
    );
    return toContract(extension);
  });

  const installUnpacked = Effect.fnUntraced(function* () {
    const owner = yield* electronWindow.focusedMainOrFirst;
    const picked = yield* dialog.pickFolder({ owner, defaultPath: Option.none() });
    if (Option.isNone(picked)) return { status: "cancelled" } as const;
    const directory = picked.value;
    const { manifest, summary } = yield* readSummary(directory);
    const key =
      typeof manifest === "object" && manifest !== null && "key" in manifest
        ? manifest.key
        : undefined;
    const id = chromiumExtensionId(
      typeof key === "string" ? Buffer.from(key, "base64") : Buffer.from(directory),
    );
    if (!(yield* confirm(summary, `From the folder ${directory}`))) {
      return { status: "cancelled" } as const;
    }
    const extension = yield* register({
      id,
      path: directory,
      source: "unpacked",
      enabled: true,
      name: summary.name,
      version: summary.version,
      ...(summary.popup === undefined ? {} : { popup: summary.popup }),
    });
    return { status: "installed", extension } as const;
  });

  const installFromWebStore = Effect.fnUntraced(function* (reference: string) {
    const id = parseWebStoreReference(reference);
    if (id === undefined) {
      return {
        status: "failed",
        message: "Enter a Chrome Web Store link or extension ID.",
      } as const;
    }
    const response = yield* Effect.tryPromise({
      try: () => net.fetch(webStoreDownloadUrl(id, process.versions.chrome ?? "140.0.0.0")),
      catch: toError,
    });
    if (!response.ok) {
      return {
        status: "failed",
        message: `The Chrome Web Store returned ${response.status} for ${id}.`,
      } as const;
    }
    const crx = new Uint8Array(
      yield* Effect.tryPromise({ try: () => response.arrayBuffer(), catch: toError }),
    );
    const publicKey = yield* attempt(() => crxPublicKeyForId(crx, id));
    const files = yield* attempt(() => unpackZip(crxZipPayload(crx)));
    const staging = path.join(storeRoot, `${id}.staging`);
    yield* fileSystem.remove(staging, { recursive: true, force: true });
    for (const [name, bytes] of files) {
      const target = path.join(staging, ...name.split("/"));
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      yield* fileSystem.writeFile(target, bytes);
    }
    const cleanup = fileSystem
      .remove(staging, { recursive: true, force: true })
      .pipe(Effect.ignore);
    const { manifest, summary } = yield* readSummary(staging).pipe(Effect.tapError(() => cleanup));
    if (!(yield* confirm(summary, `From the Chrome Web Store (${id})`))) {
      yield* cleanup;
      return { status: "cancelled" } as const;
    }
    // Without "key", Electron would derive the id from the folder instead of keeping the store's.
    if (
      publicKey !== undefined &&
      typeof manifest === "object" &&
      manifest !== null &&
      !("key" in manifest)
    ) {
      const withKey = yield* encodeJsonText({
        ...manifest,
        key: Buffer.from(publicKey).toString("base64"),
      }).pipe(Effect.mapError(toError));
      yield* fileSystem.writeFileString(path.join(staging, "manifest.json"), withKey);
    }
    const installed = path.join(storeRoot, id);
    const previous = (yield* SynchronizedRef.get(registryRef)).find((entry) => entry.id === id);
    if (previous) unloadEverywhere(previous);
    yield* fileSystem.remove(installed, { recursive: true, force: true });
    yield* fileSystem.rename(staging, installed);
    const extension = yield* register({
      id,
      path: installed,
      source: "webStore",
      enabled: true,
      name: summary.name,
      version: summary.version,
      ...(summary.popup === undefined ? {} : { popup: summary.popup }),
    });
    return { status: "installed", extension } as const;
  });

  const find = Effect.fnUntraced(function* (id: string) {
    const extension = (yield* SynchronizedRef.get(registryRef)).find((entry) => entry.id === id);
    if (extension === undefined) {
      return yield* new BrowserExtensionError({ message: "That extension is not installed." });
    }
    return extension;
  });

  return BrowserExtensions.of({
    list: SynchronizedRef.get(registryRef).pipe(Effect.map((registry) => registry.map(toContract))),
    install: Effect.fn("BrowserExtensions.install")(function* (input) {
      if (input.kind === "unpacked") return yield* failedInstall(installUnpacked());
      return yield* failedInstall(installFromWebStore(input.reference));
    }),
    setEnabled: Effect.fn("BrowserExtensions.setEnabled")(function* (id, enabled) {
      const extension = yield* find(id);
      yield* SynchronizedRef.updateEffect(registryRef, (registry) => {
        const next = registry.map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
        return persist(next).pipe(Effect.as(next));
      });
      if (!enabled) {
        unloadEverywhere(extension);
        loadErrors.delete(id);
        return;
      }
      yield* Effect.promise(() =>
        Promise.all([...sessions].map((target) => loadInto(target, extension))),
      );
    }),
    remove: Effect.fn("BrowserExtensions.remove")(function* (id) {
      const extension = yield* find(id);
      unloadEverywhere(extension);
      loadErrors.delete(id);
      yield* SynchronizedRef.updateEffect(registryRef, (registry) => {
        const next = registry.filter((entry) => entry.id !== id);
        return persist(next).pipe(Effect.as(next));
      });
      // An unpacked extension is the user's own folder; only store copies belong to T3 Code.
      if (extension.source === "webStore") {
        yield* fileSystem
          .remove(extension.path, { recursive: true, force: true })
          .pipe(Effect.ignore);
      }
    }),
    openPopup: Effect.fn("BrowserExtensions.openPopup")(function* (target, id) {
      const extension = yield* find(id);
      if (!extension.enabled || extension.popup === undefined) {
        return yield* new BrowserExtensionError({ message: "This extension has no popup." });
      }
      if (!sessions.has(target)) {
        return yield* new BrowserExtensionError({ message: "Extensions are off in incognito." });
      }
      yield* Effect.promise(() => loadInto(target, extension));
      const loaded = loadedIn(target, extension);
      if (loaded === undefined) {
        return yield* new BrowserExtensionError({
          message: loadErrors.get(extension.id) ?? "The extension could not be loaded.",
        });
      }
      const owner = Option.getOrUndefined(yield* electronWindow.focusedMainOrFirst);
      const popup = new BrowserWindow({
        width: 380,
        height: 560,
        title: extension.name,
        ...(owner === undefined ? {} : { parent: owner }),
        webPreferences: { session: target, sandbox: true, contextIsolation: true },
      });
      popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      // Chrome closes an action popup when it loses focus.
      popup.on("blur", () => {
        if (!popup.isDestroyed()) popup.close();
      });
      void popup.loadURL(`${loaded.url}${extension.popup.replace(/^\//, "")}`);
    }),
  });
}).pipe(Effect.withSpan("BrowserExtensions.make"));

export const layer = Layer.effect(BrowserExtensions, make);
