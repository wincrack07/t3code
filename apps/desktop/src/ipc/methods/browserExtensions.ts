import {
  BrowserExtension,
  BrowserExtensionIdInput,
  BrowserExtensionInstallInput,
  BrowserExtensionInstallResult,
  BrowserExtensionOpenPopupInput,
  BrowserExtensionSetEnabledInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as BrowserExtensions from "../../preview/BrowserExtensions/BrowserExtensions.ts";
import * as PreviewManager from "../../preview/Manager.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const listBrowserExtensions = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_LIST_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(BrowserExtension),
  handler: Effect.fn("desktop.ipc.browserExtensions.list")(function* () {
    return yield* (yield* BrowserExtensions.BrowserExtensions).list;
  }),
});

// The main process shows the permission prompt itself, so no renderer can install silently.
export const installBrowserExtension = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_INSTALL_CHANNEL,
  payload: BrowserExtensionInstallInput,
  result: BrowserExtensionInstallResult,
  handler: Effect.fn("desktop.ipc.browserExtensions.install")(function* (input) {
    return yield* (yield* BrowserExtensions.BrowserExtensions).install(input);
  }),
});

export const setBrowserExtensionEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_SET_ENABLED_CHANNEL,
  payload: BrowserExtensionSetEnabledInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browserExtensions.setEnabled")(function* ({ id, enabled }) {
    yield* (yield* BrowserExtensions.BrowserExtensions).setEnabled(id, enabled);
  }),
});

export const removeBrowserExtension = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_REMOVE_CHANNEL,
  payload: BrowserExtensionIdInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browserExtensions.remove")(function* ({ id }) {
    yield* (yield* BrowserExtensions.BrowserExtensions).remove(id);
  }),
});

export const openBrowserExtensionPopup = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_OPEN_POPUP_CHANNEL,
  payload: BrowserExtensionOpenPopupInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browserExtensions.openPopup")(function* ({ tabId, id }) {
    const session = yield* (yield* PreviewManager.PreviewManager).getTabSession(tabId);
    yield* (yield* BrowserExtensions.BrowserExtensions).openPopup(session, id);
  }),
});
