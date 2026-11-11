import { DesktopFinderItemSchema, DesktopFinderStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopFinderIntegration } from "../../app/DesktopFinderIntegration.ts";
import * as Channels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const state = makeIpcMethod({
  channel: Channels.FINDER_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopFinderStateSchema,
  handler: Effect.fn("desktop.ipc.finder.state")(function* () {
    return yield* (yield* DesktopFinderIntegration).state;
  }),
});
export const install = makeIpcMethod({
  channel: Channels.FINDER_INSTALL_CHANNEL,
  payload: Schema.Boolean,
  result: DesktopFinderStateSchema,
  handler: Effect.fn("desktop.ipc.finder.install")(function* (installed) {
    return yield* (yield* DesktopFinderIntegration).setInstalled(installed);
  }),
});
export const inspect = makeIpcMethod({
  channel: Channels.FINDER_INSPECT_CHANNEL,
  payload: Schema.String,
  result: Schema.Array(DesktopFinderItemSchema),
  handler: Effect.fn("desktop.ipc.finder.inspect")(function* (url) {
    return yield* (yield* DesktopFinderIntegration).inspect(url);
  }),
});
export const read = makeIpcMethod({
  channel: Channels.FINDER_READ_CHANNEL,
  payload: Schema.String,
  result: Schema.Uint8Array,
  handler: Effect.fn("desktop.ipc.finder.read")(function* (id) {
    return yield* (yield* DesktopFinderIntegration).read(id);
  }),
});
