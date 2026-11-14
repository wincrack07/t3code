import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "./DesktopIpc.ts";

it.effect("answers only app windows' top frames", () =>
  Effect.gen(function* () {
    const mainFrame = {};
    const secondFrame = {};
    const main = { webContents: { id: 1, mainFrame } } as unknown as Electron.BrowserWindow;
    const second = {
      webContents: { id: 3, mainFrame: secondFrame },
    } as unknown as Electron.BrowserWindow;
    const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const sync = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
    const ipc = yield* DesktopIpc.DesktopIpc.pipe(
      Effect.provide(
        DesktopIpc.layer({
          removeHandler: (channel) => void invoke.delete(channel),
          handle: (channel, listener) => void invoke.set(channel, listener),
          removeAllListeners: (channel) => void sync.delete(channel),
          on: (channel, listener) => void sync.set(channel, listener),
        }).pipe(
          Layer.provide(
            Layer.mock(ElectronWindow.ElectronWindow, {
              main: Effect.succeedSome(main),
              fromSender: (id) =>
                id === 1 || id === 3
                  ? Effect.succeedSome(id === 1 ? main : second)
                  : Effect.succeedNone,
            }),
          ),
        ),
      ),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: "token",
        payload: Schema.Void,
        result: Schema.String,
        handler: () => Effect.succeed("secret"),
      }),
    );
    yield* ipc.handleSync({
      channel: "token-sync",
      handler: (event) => Effect.succeed(event?.sender.id ? "secret" : "missing sender"),
    });

    const senders = {
      app: { sender: { id: 1 }, senderFrame: mainFrame },
      secondApp: { sender: { id: 3 }, senderFrame: secondFrame },
      appSubframe: { sender: { id: 1 }, senderFrame: {} },
      secondAppSubframe: { sender: { id: 3 }, senderFrame: {} },
      previewGuest: { sender: { id: 2 }, senderFrame: {} },
    };
    const results: Record<string, unknown> = {};
    for (const [name, sender] of Object.entries(senders)) {
      const event = { ...sender, returnValue: "unset" as unknown };
      sync.get("token-sync")!(event);
      results[name] = [
        yield* Effect.promise(() =>
          Promise.resolve(invoke.get("token")!(sender, undefined)).catch(() => "rejected"),
        ),
        event.returnValue,
      ];
    }
    assert.deepEqual(results, {
      app: ["secret", "secret"],
      secondApp: ["secret", "secret"],
      appSubframe: ["rejected", undefined],
      secondAppSubframe: ["rejected", undefined],
      previewGuest: ["rejected", undefined],
    });
  }),
);
