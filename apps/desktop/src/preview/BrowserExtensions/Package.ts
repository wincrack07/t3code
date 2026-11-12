// @effect-diagnostics nodeBuiltinImport:off -- Pure, synchronous package parsing; ids need a sync SHA-256.
import * as NodeCrypto from "node:crypto";
import { unzipSync } from "fflate";

const WEB_STORE_ID = /^[a-p]{32}$/;

/** Accepts a bare Chrome Web Store id or any chromewebstore.google.com / chrome.google.com URL. */
export function parseWebStoreReference(reference: string): string | undefined {
  const trimmed = reference.trim();
  if (WEB_STORE_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.hostname !== "chromewebstore.google.com" && url.hostname !== "chrome.google.com") {
    return undefined;
  }
  return url.pathname.split("/").find((segment) => WEB_STORE_ID.test(segment));
}

export function webStoreDownloadUrl(id: string, chromeVersion: string): string {
  const query = new URLSearchParams({
    response: "redirect",
    prodversion: chromeVersion,
    acceptformat: "crx2,crx3",
    x: `id=${id}&uc`,
  });
  return `https://clients2.google.com/service/update2/crx?${query.toString()}`;
}

/**
 * Returns the zip archive inside a CRX2 or CRX3 package. The signature is not checked: the bytes
 * come straight from the Web Store over HTTPS, and Electron never verifies extensions either.
 */
export function crxZipPayload(crx: Uint8Array): Uint8Array {
  const view = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  if (crx.byteLength < 12 || new TextDecoder().decode(crx.subarray(0, 4)) !== "Cr24") {
    throw new Error("Not a Chrome extension package.");
  }
  const version = view.getUint32(4, true);
  let start: number;
  if (version === 3) {
    start = 12 + view.getUint32(8, true);
  } else if (version === 2) {
    if (crx.byteLength < 16) throw new Error("Truncated Chrome extension package.");
    start = 16 + view.getUint32(8, true) + view.getUint32(12, true);
  } else {
    throw new Error(`Unsupported Chrome extension package version ${version}.`);
  }
  if (start >= crx.byteLength) throw new Error("Truncated Chrome extension package.");
  return crx.subarray(start);
}

/** Unzips into a path → bytes map, rejecting entries that would land outside the target folder. */
export function unpackZip(zip: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(unzipSync(zip))) {
    if (name.endsWith("/")) continue;
    const segments = name.split(/[\\/]/);
    if (
      name.startsWith("/") ||
      /^[a-zA-Z]:/.test(name) ||
      segments.some((segment) => segment === ".." || segment === "")
    ) {
      throw new Error(`The package contains an unsafe path: ${name}`);
    }
    files.set(segments.join("/"), bytes);
  }
  return files;
}

export interface ExtensionManifestSummary {
  readonly name: string;
  readonly version: string;
  readonly manifestVersion: number;
  readonly popup: string | undefined;
  /** API permissions plus host access, in the order the manifest declares them. */
  readonly permissions: ReadonlyArray<string>;
  /** Declared API permissions Electron does not implement, so those features will fail. */
  readonly unsupported: ReadonlyArray<string>;
}

// Electron 44's extension APIs (docs/api/extensions.md on its 44-x-y branch); tabs is partial.
const SUPPORTED_PERMISSIONS: ReadonlySet<string> = new Set([
  "activeTab",
  "management",
  "scripting",
  "storage",
  "tabs",
  "unlimitedStorage",
  "webRequest",
  "webRequestBlocking",
]);

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** Resolves `__MSG_key__` names against the default locale's messages, if the package has them. */
function localizedName(raw: string, messages: JsonRecord | undefined): string {
  const match = /^__MSG_(.+)__$/.exec(raw);
  if (!match || !messages) return raw;
  const key = match[1]!.toLowerCase();
  const entry = Object.entries(messages).find(([candidate]) => candidate.toLowerCase() === key);
  const message = entry && isRecord(entry[1]) ? entry[1].message : undefined;
  return typeof message === "string" && message.trim() !== "" ? message.trim() : raw;
}

export function summarizeManifest(
  manifest: unknown,
  messages?: JsonRecord,
): ExtensionManifestSummary {
  if (!isRecord(manifest)) throw new Error("manifest.json is not an object.");
  const { name, version } = manifest;
  if (typeof name !== "string" || name.trim() === "") throw new Error("manifest.json has no name.");
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("manifest.json has no version.");
  }
  const manifestVersion = manifest.manifest_version === 3 ? 3 : 2;
  const action = isRecord(manifest.action)
    ? manifest.action
    : isRecord(manifest.browser_action)
      ? manifest.browser_action
      : undefined;
  const popup =
    typeof action?.default_popup === "string" && action.default_popup.trim() !== ""
      ? action.default_popup.trim()
      : undefined;
  const apiPermissions = strings(manifest.permissions);
  const hostPermissions = strings(manifest.host_permissions);
  const contentScriptHosts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.flatMap((script) =>
        isRecord(script) ? strings(script.matches) : [],
      )
    : [];
  const permissions = [...new Set([...apiPermissions, ...hostPermissions, ...contentScriptHosts])];
  const unsupported = [
    ...new Set(
      [...apiPermissions, ...strings(manifest.optional_permissions)].filter(
        (permission) => !SUPPORTED_PERMISSIONS.has(permission) && !permission.includes("://"),
      ),
    ),
  ];
  return {
    name: localizedName(name.trim(), messages),
    version: version.trim(),
    manifestVersion,
    popup,
    permissions,
    unsupported,
  };
}

/** Chromium's id for a public key (or an unpacked path): SHA-256's first 16 bytes, a–p per nibble. */
export function chromiumExtensionId(input: Uint8Array): string {
  const hex = NodeCrypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  return [...hex].map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16))).join("");
}

function readVarint(bytes: Uint8Array, offset: number): readonly [value: number, next: number] {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = bytes[cursor]!;
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, cursor];
    shift += 7;
    if (shift > 49) break;
  }
  throw new Error("Malformed Chrome extension header.");
}

/** Length-delimited fields of one protobuf message, by field number. */
function protobufFields(
  bytes: Uint8Array,
): ReadonlyArray<readonly [field: number, value: Uint8Array]> {
  const fields: Array<readonly [number, Uint8Array]> = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, cursor);
    const wireType = tag % 8;
    if (wireType === 0) {
      cursor = readVarint(bytes, afterTag)[1];
    } else if (wireType === 2) {
      const [length, start] = readVarint(bytes, afterTag);
      if (start + length > bytes.length) throw new Error("Malformed Chrome extension header.");
      fields.push([Math.floor(tag / 8), bytes.subarray(start, start + length)]);
      cursor = start + length;
    } else {
      throw new Error("Malformed Chrome extension header.");
    }
  }
  return fields;
}

/**
 * The CRX3 header carries the publisher's public key; the one whose hash is the requested id lets
 * the unpacked copy keep the store id. Returns undefined for CRX2 or when no key matches.
 */
export function crxPublicKeyForId(crx: Uint8Array, id: string): Uint8Array | undefined {
  const view = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  if (crx.byteLength < 12 || view.getUint32(4, true) !== 3) return undefined;
  const header = crx.subarray(12, 12 + view.getUint32(8, true));
  for (const [field, proof] of protobufFields(header)) {
    if (field !== 2 && field !== 3) continue;
    for (const [proofField, publicKey] of protobufFields(proof)) {
      if (proofField === 1 && chromiumExtensionId(publicKey) === id) return publicKey;
    }
  }
  return undefined;
}
