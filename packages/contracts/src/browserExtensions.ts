import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const BrowserExtension = Schema.Struct({
  /** Electron's extension id, which matches the Chrome Web Store id for store installs. */
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  source: Schema.Literals(["webStore", "unpacked"]),
  enabled: Schema.Boolean,
  /** Whether the extension declares a toolbar popup the browser panel can open. */
  hasPopup: Schema.Boolean,
  /** Set when the extension failed to load at the last attempt. */
  loadError: Schema.optional(Schema.String),
});
export type BrowserExtension = typeof BrowserExtension.Type;

export const BrowserExtensionInstallInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("webStore"), reference: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("unpacked") }),
]);
export type BrowserExtensionInstallInput = typeof BrowserExtensionInstallInput.Type;

export const BrowserExtensionInstallResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("installed"), extension: BrowserExtension }),
  Schema.Struct({ status: Schema.Literal("cancelled") }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
]);
export type BrowserExtensionInstallResult = typeof BrowserExtensionInstallResult.Type;

export const BrowserExtensionSetEnabledInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});

export const BrowserExtensionIdInput = Schema.Struct({ id: TrimmedNonEmptyString });

export const BrowserExtensionOpenPopupInput = Schema.Struct({
  tabId: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
