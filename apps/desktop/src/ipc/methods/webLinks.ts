import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWebLinks from "../../app/DesktopWebLinks.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const setReady = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.WEB_LINK_READY_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.webLinks.setReady")(function* (ready, event) {
    const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
    yield* webLinks.setRendererReady(ready, event?.sender.id);
  }),
});

export const openThread = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_THREAD_CHANNEL,
  payload: Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.webLinks.openThread")(function* (
    { environmentId, threadId },
    event,
  ) {
    const windows = yield* ElectronWindow.ElectronWindow;
    if (Option.isNone(yield* windows.fromSender(event?.sender.id))) return;
    const links = yield* DesktopWebLinks.DesktopWebLinks;
    yield* links.receive(
      `t3code://threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`,
    );
  }),
});
