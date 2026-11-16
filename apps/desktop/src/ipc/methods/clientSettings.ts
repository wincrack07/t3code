import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { ClientSettingsSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CLIENT_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(ClientSettingsSchema),
  handler: Effect.fn("desktop.ipc.clientSettings.get")(function* () {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    return Option.getOrNull(yield* clientSettings.get);
  }),
});

export const setClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CLIENT_SETTINGS_CHANNEL,
  payload: ClientSettingsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.clientSettings.set")(function* (settings, event) {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const snapShot = yield* DesktopSnapShot.DesktopSnapShot;
    yield* clientSettings.set(settings);
    const windows = yield* (yield* ElectronWindow.ElectronWindow).appWindows;
    // Not back to the saving window: an echo swaps its snapshot mid-save and the save retries forever.
    yield* Effect.sync(() => {
      for (const window of windows) {
        if (window.isDestroyed() || window.webContents.id === event?.sender.id) continue;
        window.webContents.send(IpcChannels.CLIENT_SETTINGS_CHANGED_CHANNEL, settings);
      }
    });
    yield* snapShot.configure(settings);
  }),
});
