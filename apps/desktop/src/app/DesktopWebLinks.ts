import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { WEB_LINK_OPEN_CHANNEL } from "../ipc/channels.ts";

export const isWebLink = (value: string) => {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
};

export const isWebPageFile = (path: string) => /\.x?html?$/i.test(path);

export class DesktopWebLinks extends Context.Service<
  DesktopWebLinks,
  {
    readonly receive: (url: string) => Effect.Effect<void>;
    readonly setRendererReady: (ready: boolean, senderId?: number) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopWebLinks") {}

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const pending: Array<string> = [];
  const listeners = new Map<Electron.WebContents, () => void>();

  const flush = Effect.gen(function* () {
    if (pending.length === 0) return;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window)) return;
    const contents = window.value.webContents;
    if (!listeners.has(contents) || contents.isDestroyed()) return;
    for (const url of pending.splice(0)) contents.send(WEB_LINK_OPEN_CHANNEL, url);
    yield* desktopWindow.activate.pipe(Effect.ignore);
  });

  const setReady = Effect.fn("DesktopWebLinks.setReady")(function* (
    ready: boolean,
    senderId?: number,
  ) {
    const window = yield* senderId === undefined
      ? electronWindow.currentMainOrFirst
      : electronWindow.fromSender(senderId);
    if (Option.isNone(window)) return;
    const contents = window.value.webContents;
    if (!ready) {
      listeners.get(contents)?.();
      return;
    }
    if (contents.isDestroyed() || listeners.has(contents)) return;
    const stop = () => {
      listeners.delete(contents);
      contents.removeListener("did-start-navigation", navigation);
      contents.removeListener("render-process-gone", stop);
      contents.removeListener("destroyed", stop);
      window.value.removeListener("focus", focus);
    };
    const navigation = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ) => {
      if (event.isMainFrame && !event.isSameDocument) stop();
    };
    const focus = () => {
      void runPromise(flush);
    };
    window.value.on("focus", focus);
    listeners.set(contents, stop);
    contents.on("did-start-navigation", navigation);
    contents.on("render-process-gone", stop);
    contents.once("destroyed", stop);
  });

  return DesktopWebLinks.of({
    receive: Effect.fn("DesktopWebLinks.receive")(function (url) {
      return Effect.suspend(() => {
        pending.push(url);
        return listeners.size === 0
          ? desktopWindow.activate.pipe(Effect.ignore, Effect.andThen(flush))
          : flush;
      });
    }),
    setRendererReady: Effect.fn("DesktopWebLinks.setRendererReady")(function (ready, senderId) {
      return setReady(ready, senderId);
    }, Effect.andThen(flush)),
  });
});

export const layer = Layer.effect(DesktopWebLinks, make);
