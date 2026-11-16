import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { setClientSettings } from "./clientSettings.ts";

describe("client settings IPC", () => {
  it.effect("a save reaches the other windows, not the one that saved", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const received: number[] = [];
        const fakeWindow = (id: number) =>
          ({
            isDestroyed: () => false,
            webContents: { id, send: () => received.push(id) },
          }) as unknown as Electron.BrowserWindow;
        let listener: DesktopIpc.DesktopIpcHandleListener | undefined;
        const ipc = DesktopIpc.make(
          {
            removeHandler: vi.fn(),
            handle: (_channel, registered) => {
              listener = registered;
            },
            removeAllListeners: vi.fn(),
            on: vi.fn(),
          },
          () => Effect.succeed(true),
        );
        yield* ipc.handle(setClientSettings).pipe(
          Effect.provideService(ElectronWindow.ElectronWindow, {
            appWindows: Effect.succeed([fakeWindow(7), fakeWindow(8)]),
          } as unknown as ElectronWindow.ElectronWindow["Service"]),
          Effect.provideService(DesktopClientSettings.DesktopClientSettings, {
            get: Effect.succeedNone,
            set: () => Effect.void,
          }),
          Effect.provideService(DesktopSnapShot.DesktopSnapShot, {
            configure: () => Effect.void,
          } as unknown as DesktopSnapShot.DesktopSnapShot["Service"]),
        );
        yield* Effect.promise(() =>
          Promise.resolve(listener!({ sender: { id: 7 } }, DEFAULT_CLIENT_SETTINGS)),
        );
        assert.deepStrictEqual(received, [8]);
      }),
    ),
  );
});
