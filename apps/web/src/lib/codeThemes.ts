import { READABLE_LIGHT_THEME_NAME } from "./readableSyntaxTheme";

type Appearance = "light" | "dark";

export interface CodeThemeOption {
  readonly id: string;
  readonly label: string;
}

// A curated subset of the Highlights catalog @pierre/diffs already ships; each theme is its own
// lazy chunk, loaded only when picked. The first entry of each list is the default.
export const CODE_THEME_OPTIONS: Readonly<Record<Appearance, ReadonlyArray<CodeThemeOption>>> = {
  light: [
    { id: READABLE_LIGHT_THEME_NAME, label: "Pierre Light (readable)" },
    { id: "pierre-light", label: "Pierre Light" },
    { id: "pierre-light-soft", label: "Pierre Light Soft" },
    { id: "pierre-light-vibrant", label: "Pierre Light Vibrant" },
    { id: "pierre-light-protanopia-deuteranopia", label: "Pierre Light Protan/Deutan" },
    { id: "pierre-light-tritanopia", label: "Pierre Light Tritan" },
    { id: "github-light", label: "GitHub Light" },
    { id: "github-light-high-contrast", label: "GitHub Light High Contrast" },
    { id: "one-light", label: "One Light" },
    { id: "light-plus", label: "Light+" },
    { id: "catppuccin-latte", label: "Catppuccin Latte" },
    { id: "solarized-light", label: "Solarized Light" },
    { id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
    { id: "vitesse-light", label: "Vitesse Light" },
    { id: "everforest-light", label: "Everforest Light" },
    { id: "gruvbox-light-medium", label: "Gruvbox Light" },
  ],
  dark: [
    { id: "pierre-dark", label: "Pierre Dark" },
    { id: "pierre-dark-soft", label: "Pierre Dark Soft" },
    { id: "pierre-dark-vibrant", label: "Pierre Dark Vibrant" },
    { id: "pierre-dark-protanopia-deuteranopia", label: "Pierre Dark Protan/Deutan" },
    { id: "pierre-dark-tritanopia", label: "Pierre Dark Tritan" },
    { id: "github-dark", label: "GitHub Dark" },
    { id: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
    { id: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
    { id: "one-dark-pro", label: "One Dark Pro" },
    { id: "dark-plus", label: "Dark+" },
    { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
    { id: "dracula", label: "Dracula" },
    { id: "monokai", label: "Monokai" },
    { id: "nord", label: "Nord" },
    { id: "night-owl", label: "Night Owl" },
    { id: "tokyo-night", label: "Tokyo Night" },
    { id: "rose-pine", label: "Rosé Pine" },
    { id: "solarized-dark", label: "Solarized Dark" },
    { id: "vitesse-dark", label: "Vitesse Dark" },
    { id: "gruvbox-dark-medium", label: "Gruvbox Dark" },
    { id: "ayu-dark", label: "Ayu Dark" },
    { id: "vesper", label: "Vesper" },
  ],
};

export type CodeThemePreferences = Readonly<Record<Appearance, string>>;

/** Unknown or empty preferences fall back to the appearance's default theme. */
export function resolveCodeThemeName(appearance: Appearance, preference: string): string {
  const options = CODE_THEME_OPTIONS[appearance];
  return options.some((option) => option.id === preference) ? preference : options[0]!.id;
}

// Written from client settings by appInit, so code outside React reads the same choice.
let preferences: CodeThemePreferences = { light: "", dark: "" };
const listeners = new Set<() => void>();

export function setCodeThemePreferences(next: CodeThemePreferences): void {
  if (next.light === preferences.light && next.dark === preferences.dark) return;
  preferences = next;
  for (const listener of listeners) listener();
}

export function getCodeThemePreferences(): CodeThemePreferences {
  return preferences;
}

export function subscribeCodeThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
