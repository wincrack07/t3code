import { DEFAULT_TRAY_STATS, type MachineSample } from "@t3tools/contracts";
import { changedTitle, trayStatsTitle, trayStatsRows } from "./trayStats.ts";
import { MENU_ACTION_CHANNEL } from "../ipc/channels.ts";
import type { KeepAwakeSession, KeepAwakeStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as Electron from "electron";

export const make = Effect.fn("KeepAwakeTray.make")(function* () {
  const platform = yield* HostProcess.Platform;
  const supportsHeaders =
    platform === "darwin" && Number(process.getSystemVersion().split(".")[0]) >= 14;
  const actions = yield* PubSub.unbounded<{
    readonly sourceId: string;
    readonly session: KeepAwakeSession;
  }>();
  let currentSource: string | undefined;
  let tray: Electron.Tray | undefined;
  let sample: MachineSample | undefined;
  let active: boolean | undefined;
  let titleChanged = changedTitle();
  const update = Effect.fn("KeepAwakeTray.update")(function* (
    sourceId: string,
    status: KeepAwakeStatus,
    nextSample?: MachineSample,
  ) {
    if (platform !== "darwin") return;
    yield* Effect.promise(() => Electron.app.whenReady());
    yield* Effect.sync(() => {
      if (currentSource !== sourceId) sample = undefined;
      currentSource = sourceId;
      const settings = status.defaults.trayStats ?? DEFAULT_TRAY_STATS;
      sample = settings.enabled ? (nextSample ?? sample) : undefined;
      if (!tray) {
        const image = Electron.nativeImage.createFromDataURL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAACXBIWXMAAAsTAAALEwEAmpwYAAAApElEQVQ4jcWTQQrCMBBFn+68lHgU96U36TXqAdy6yD2yU/e5gSgDfxFKmkwJ6oeBSf7w0g8d+KJGVa13Kahq/W9BY2+0Cbg5avJESg1IymYuwGkNFDY8dgdeJZgXFNQfgAcw/x2UFO2paMde0FyCICM2QLEUZakz8AaGFX+Qb3NV7YGrhuPi/4m6N9/mmtrpRfv8HGRnuze/Ktshz3rkVdy7btAHXhRfQpqfgWsAAAAASUVORK5CYII=",
        );
        image.setTemplateImage(true);
        tray = new Electron.Tray(image);
      }
      const label = !status.supported
        ? "Not supported"
        : !status.active
          ? status.mode === "agents"
            ? "Waiting for agents"
            : "Off"
          : status.mode === "agents"
            ? `${status.agents} agents`
            : status.endsAt
              ? `until ${DateTime.toDateUtc(DateTime.makeUnsafe(status.endsAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Indefinitely";
      const statsTitle = trayStatsTitle(settings, sample);
      const title = statsTitle || label;
      if (titleChanged(title))
        tray.setTitle(title, statsTitle ? { fontType: "monospacedDigit" } : {});
      tray.setToolTip(`T3 Code · Keep awake · ${label} · MB/s = megabytes per second`);
      if (active !== status.active) {
        active = status.active;
        const icon = Electron.nativeImage.createFromDataURL(
          status.active
            ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAqUlEQVR4nGNgIB/8R8JYQS4U42P/x4IxwH4oxsemr0HEeA3dMBTQA8S7icA92GxH99I7Aoa8Q1KzDIgdcBm0H5sEDsseAvFfbIYRaxBMDScQPwLipQNuEMxrjxkgXrOj1KCl2AxhgErcImDQLQYsXkEHCQyQxJWNQz4bKp9AyCAmIN4EVQyyGTn93IKKb4KqIwgYoTYuRTNoKVSckZABuQzEZQ9knEsTgwCYynQtZBaZqwAAAABJRU5ErkJggg=="
            : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAACXBIWXMAAAsTAAALEwEAmpwYAAAApElEQVQ4jcWTQQrCMBBFn+68lHgU96U36TXqAdy6yD2yU/e5gSgDfxFKmkwJ6oeBSf7w0g8d+KJGVa13Kahq/W9BY2+0Cbg5avJESg1IymYuwGkNFDY8dgdeJZgXFNQfgAcw/x2UFO2paMde0FyCICM2QLEUZakz8AaGFX+Qb3NV7YGrhuPi/4m6N9/mmtrpRfv8HGRnuze/Ktshz3rkVdy7btAHXhRfQpqfgWsAAAAASUVORK5CYII=",
        );
        icon.setTemplateImage(true);
        tray.setImage(icon);
      }
      const send = (session: KeepAwakeSession) => () => {
        PubSub.publishUnsafe(actions, { sourceId, session });
      };
      tray.setContextMenu(
        Electron.Menu.buildFromTemplate([
          ...(settings.enabled
            ? [
                ...trayStatsRows(sample).map((label) =>
                  supportsHeaders ? { label, type: "header" as const } : { label, enabled: false },
                ),
                { type: "separator" as const },
              ]
            : []),
          { label: `Keep awake: ${label}`, enabled: false },
          {
            label: "End session now",
            enabled: status.supported && status.mode !== "off",
            click: send({ mode: "off" }),
          },
          { type: "separator" },
          {
            label: "1 hour",
            enabled: status.supported,
            click: send({ mode: "duration", minutes: 60 }),
          },
          {
            label: "While agents work",
            enabled: status.supported,
            click: send({ mode: "agents" }),
          },
          { label: "Indefinitely", enabled: status.supported, click: send({ mode: "indefinite" }) },
          { type: "separator" },
          {
            label: "Open machine monitor",
            click: () => {
              const window = Electron.BrowserWindow.getAllWindows().find(
                (window) => !window.isDestroyed(),
              );
              window?.show();
              window?.focus();
              window?.webContents.send(MENU_ACTION_CHANNEL, "machine-monitor.open");
            },
          },
          {
            label: "Open T3 Code",
            click: () => {
              const window = Electron.BrowserWindow.getAllWindows().find(
                (window) => !window.isDestroyed(),
              );
              window?.show();
              window?.focus();
            },
          },
        ]),
      );
    });
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => tray?.destroy()));
  const remove = Effect.fn("KeepAwakeTray.remove")((sourceId: string) =>
    Effect.sync(() => {
      if (currentSource !== sourceId) return;
      tray?.destroy();
      tray = undefined;
      currentSource = undefined;
      sample = undefined;
      active = undefined;
      titleChanged = changedTitle();
    }),
  );
  return { update, remove, actions: Stream.fromPubSub(actions) };
});
