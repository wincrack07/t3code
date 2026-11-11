import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { useLocation } from "@tanstack/react-router";
import { useThreadRouteTarget } from "./useThreadRouteTarget";
import { useThreadColumnsStore } from "../threadColumnsStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useQuietThreadShell, useServerConfigs } from "../state/entities";
import { useSidebarProjectGroups } from "./useSidebarProjectGroups";
import { useClientSettings, useClientSettingsHydrated } from "./useSettings";
import { getStandardPaintedThemeColors, themeColorToHex } from "../themePalette";
import { computeSidebarTint, resolveSidebarColor } from "../sidebarColors";

const decodeCache = Schema.decodeUnknownOption(
  Schema.Struct({
    path: Schema.String,
    theme: Schema.String,
    variables: Schema.Record(Schema.String, Schema.String),
  }),
);
const CACHE_KEY = "t3code:sidebar-tint:v1";
const themeStamp = () =>
  JSON.stringify([
    document.documentElement.dataset.themeId ?? "",
    document.documentElement.classList.contains("dark"),
    localStorage.getItem("t3code:themes:v1"),
    localStorage.getItem("t3code:theme-halves:v1"),
  ]);

function readStartupTint(): Record<string, string> {
  try {
    const result = decodeCache(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
    if (Option.isNone(result)) return {};
    const cached = result.value;
    if (cached.path !== location.pathname || cached.theme !== themeStamp()) return {};
    const keys = [
      "--sidebar",
      "--sidebar-control-surface",
      "--sidebar-row-hover",
      "--sidebar-row-active",
      "--sidebar-row-selected",
      "--sidebar-border",
    ];
    if (!keys.every((key) => /^#[0-9a-f]{6}$/i.test(cached.variables[key] ?? ""))) return {};
    return Object.fromEntries(keys.map((key) => [key, cached.variables[key]!]));
  } catch {
    return {};
  }
}

function readPaintedSidebar() {
  const root = document.documentElement;
  const colors = {
    ...getStandardPaintedThemeColors(root.classList.contains("dark") ? "dark" : "light"),
  };
  const container = document.createElement("div");
  container.hidden = true;
  const sample = (token: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    container.append(probe);
    return probe;
  };
  const roles = [
    "sidebar",
    "sidebarControlSurface",
    "sidebarRowHover",
    "sidebarRowActive",
    "sidebarRowSelected",
    "sidebarBorder",
    "sidebarForeground",
    "sidebarMutedForeground",
    "errorForeground",
    "warningForeground",
    "updateForeground",
  ] as const;
  const probes = roles.map((role) => {
    const token =
      role === "sidebarForeground"
        ? "--contrast-sidebar-foreground"
        : role === "sidebarMutedForeground"
          ? "--contrast-sidebar-muted-foreground"
          : `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    return sample(token);
  });
  const protectedTokens = [
    "--info-foreground",
    "--success-foreground",
    "--guest-foreground",
    "--sidebar-icon-color",
  ];
  const protectedProbes = protectedTokens.map(sample);
  document.body.append(container);
  try {
    roles.forEach((role, index) => {
      const color = themeColorToHex(getComputedStyle(probes[index]!).color);
      if (color) colors[role] = color;
    });
    const protectedColors = protectedProbes.flatMap((probe, index) => {
      const color = themeColorToHex(getComputedStyle(probe).color);
      return color
        ? [{ color, minimum: protectedTokens[index] === "--sidebar-icon-color" ? 3 : 4.5 }]
        : [];
    });
    return { colors, protectedColors };
  } finally {
    container.remove();
  }
}

export function useSidebarTint(): CSSProperties {
  const target = useThreadRouteTarget();
  const focused = useThreadColumnsStore(
    (state) => state.columns.find((column) => column.id === state.activeId)?.threadRef ?? null,
  );
  const thread = useQuietThreadShell(
    target?.kind === "server" ? (focused ?? target.threadRef) : null,
  );
  const draft = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftSession(target.draftId) : null,
  );
  const project = draft ?? thread;
  const configs = useServerConfigs();
  const groups = useSidebarProjectGroups();
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const hydrated = useClientSettingsHydrated();
  const [painted, setPainted] = useState<ReturnType<typeof readPaintedSidebar> | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples inherited theme tokens before paint and follows root theme/contrast previews without reading each sidebar row
  useLayoutEffect(() => {
    const read = () => setPainted(readPaintedSidebar());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme-id"],
    });
    return () => observer.disconnect();
  }, []);
  const path = useLocation({ select: (state) => state.pathname });
  const [startup] = useState(readStartupTint);
  const config = project ? configs.get(project.environmentId) : null;
  const group = project
    ? groups.find((entry) =>
        entry.memberProjectRefs.some(
          (ref) =>
            ref.environmentId === project.environmentId && ref.projectId === project.projectId,
        ),
      )
    : null;
  const color = resolveSidebarColor(
    project ? config?.settings.projectSettingsOverrides[project.projectId]?.sidebarColor : null,
    folders.find((folder) => folder.projectKeys.includes(group?.projectKey ?? ""))?.sidebarColor,
  );
  const pending = painted === null || !hydrated || (target !== null && (!project || !config));
  const variables = pending
    ? startup
    : color
      ? computeSidebarTint(painted.colors, color, painted.protectedColors).variables
      : {};
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- caches the focused sidebar surface for the synchronous startup script and retires its temporary CSS scope before paint
  useLayoutEffect(() => {
    if (pending) return;
    delete document.documentElement.dataset.sidebarTintStartup;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ path, theme: themeStamp(), variables }));
    } catch {
      /* Storage can be disabled. */
    }
  }, [pending, path, variables]);
  return variables as CSSProperties;
}
