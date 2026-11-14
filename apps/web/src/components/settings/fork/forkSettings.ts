import { msg } from "gt-react";

import type { SettingsPath, SettingsSearchItem, SettingsSearchScope } from "../settingsSearch";

// Everything the fork adds to Settings lives under one nav group and route prefix, so upstream
// panels stay untouched and merges stay clean.
export const FORK_SETTINGS_PATHS = [
  "/settings/fork/composer",
  "/settings/fork/chats",
  "/settings/fork/pr-reviews",
  "/settings/fork/machine",
  "/settings/fork/monitor",
  "/settings/fork/connections",
] as const;

export type ForkSettingsPath = (typeof FORK_SETTINGS_PATHS)[number];

export const FORK_SETTINGS_SECTION_LABELS: Readonly<Record<ForkSettingsPath, string>> = {
  "/settings/fork/composer": msg("Composer"),
  "/settings/fork/chats": msg("Chats"),
  "/settings/fork/pr-reviews": msg("PR reviews"),
  "/settings/fork/machine": msg("This machine"),
  "/settings/fork/monitor": msg("Machine monitor"),
  "/settings/fork/connections": msg("Linked environments"),
};

export const FORK_SETTINGS_NAV_GROUP = {
  heading: msg("Sally's Version"),
  paths: FORK_SETTINGS_PATHS,
} as const;

export const FORK_SETTINGS_CATEGORY_SCOPES: Readonly<
  Record<ForkSettingsPath, SettingsSearchScope | null>
> = {
  "/settings/fork/composer": null,
  "/settings/fork/chats": null,
  "/settings/fork/pr-reviews": null,
  "/settings/fork/machine": null,
  "/settings/fork/monitor": "environment",
  "/settings/fork/connections": null,
};

/** Pages that act on every connected environment at once, so they hide the scope picker. */
export const FORK_SETTINGS_DEVICE_ONLY_PATHS: ReadonlyArray<ForkSettingsPath> = [
  "/settings/fork/chats",
  "/settings/fork/connections",
];

export const FORK_SETTINGS_SEARCH_ITEMS = [
  {
    id: "saved-prompts",
    title: "Saved prompts",
    to: "/settings/fork/composer",
    searchTerms: ["prompt library templates snippets presets reusable slash menu insert"],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "prompt-completion-next",
    title: "Suggest a reply when the input is empty",
    to: "/settings/fork/composer",
    scope: "environment",
    searchTerms: ["prompt suggestions next reply autocomplete ghost text tab"],
  },
  {
    id: "prompt-completion-inline",
    title: "Complete while typing",
    to: "/settings/fork/composer",
    scope: "environment",
    searchTerms: ["prompt suggestions autocomplete inline completion ghost text tab"],
  },
  {
    id: "prompt-completion-delay",
    title: "Pause before suggesting",
    to: "/settings/fork/composer",
    scope: "environment",
    searchTerms: ["prompt suggestions autocomplete delay debounce wait"],
  },
  {
    id: "prompt-completion-model",
    title: "Suggestion model",
    to: "/settings/fork/composer",
    scope: "environment",
    searchTerms: ["prompt suggestions autocomplete model provider cheap fast"],
  },
  {
    id: "prompt-polish",
    title: "Polish prompt",
    to: "/settings/fork/composer",
    searchTerms: ["rewrite composer draft prompt instruction custom rules"],
  },
  {
    id: "decisions",
    title: "Decisions",
    to: "/settings/fork/composer",
    searchTerms: ["routing custom OpenAI compatible source model auto"],
  },
  {
    id: "chat-backup",
    title: "Chat backup",
    to: "/settings/fork/chats",
    searchTerms: ["export import download zip obsidian google drive archive"],
  },
  {
    id: "chat-hub",
    title: "Chat hub",
    to: "/settings/fork/chats",
    searchTerms: ["sync upload cloudflare worker all chats search machines"],
  },
  {
    id: "pr-reviews",
    title: "PR reviews",
    to: "/settings/fork/pr-reviews",
    searchTerms: ["pull request reviewer GitHub identity triggers instructions"],
  },
  {
    id: "keep-awake",
    title: "Keep awake",
    to: "/settings/fork/machine",
    scope: "environment-defaults",
    searchTerms: ["sleep inhibit amphetamine caffeine agents duration display lid battery"],
  },
  {
    id: "menu-bar-stats",
    title: "Menu bar stats",
    to: "/settings/fork/machine",
    scope: "environment-defaults",
    searchTerms: ["tray stats CPU memory disk network speed"],
  },
  {
    id: "machine-cleanup",
    title: "Machine cleanup",
    to: "/settings/fork/machine",
    searchTerms: ["free disk space caches worktrees delete low space alert"],
  },
  {
    id: "machine-monitor",
    title: "Machine monitor",
    to: "/settings/fork/monitor",
    targetId: "machine-monitor",
    scope: "environment",
    searchTerms: ["system cpu ram memory disk storage network processes load health"],
  },
  {
    id: "show-system-monitor",
    title: "Show machine health in the sidebar",
    to: "/settings/fork/monitor",
    targetId: "system-monitor",
    searchTerms: ["system monitor sidebar footer indicator"],
  },
  {
    id: "peer-link-mesh",
    title: "Link my environments",
    to: "/settings/fork/connections",
    searchTerms: ["peer mesh link all renew unlink"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

// Pages these settings lived on before they moved here. Old deep links land on the new page.
const FORK_LEGACY_PATHS: ReadonlySet<string> = new Set([
  "/settings/general",
  "/settings/chat",
  "/settings/threads",
  "/settings/labs",
  "/settings/maintenance",
  "/settings/connections",
]);
const FORK_RENAMED_PATHS: Readonly<Record<string, ForkSettingsPath>> = {
  "/settings/pr-reviews": "/settings/fork/pr-reviews",
  "/settings/monitor": "/settings/fork/monitor",
};

export function forkMovedSettingsPath(pathname: string, hash: string): SettingsPath | null {
  const renamed = FORK_RENAMED_PATHS[pathname];
  if (renamed) return renamed;
  if (!hash || !FORK_LEGACY_PATHS.has(pathname)) return null;
  const items: ReadonlyArray<SettingsSearchItem> = FORK_SETTINGS_SEARCH_ITEMS;
  return items.find((item) => item.id === hash || item.targetId === hash)?.to ?? null;
}
