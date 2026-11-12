import "culori/css";
import { converter } from "culori/fn";
import { SidebarColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { ThemeColors } from "./themePalette";
import { themeColorToHex } from "./themePalette";

export const isSidebarColor = Schema.is(SidebarColor);

export const SIDEBAR_COLORS = [
  { name: "Red", value: "#df646c" },
  { name: "Orange", value: "#d88b50" },
  { name: "Amber", value: "#b99a45" },
  { name: "Green", value: "#64a572" },
  { name: "Teal", value: "#4fa69d" },
  { name: "Blue", value: "#629bd7" },
  { name: "Indigo", value: "#8687d2" },
  { name: "Violet", value: "#ad7dc5" },
  { name: "Pink", value: "#cc7ca5" },
] as const;

export function resolveSidebarColor(
  project: string | null | undefined,
  group: string | null | undefined,
) {
  return project ?? group ?? null;
}

type Rgb = readonly number[];
const rgb = (hex: string): Rgb =>
  [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
const mixRgb = (base: Rgb, tint: Rgb, strength: number) =>
  base.map((value, index) => value + (tint[index]! - value) * strength);
const toLab = converter("oklab");
const toRgb = converter("rgb");
const mix = (base: Rgb, tint: Rgb, amount: number) => {
  const a = toLab({ mode: "rgb", r: base[0]!, g: base[1]!, b: base[2]! });
  const b = toLab({ mode: "rgb", r: tint[0]!, g: tint[1]!, b: tint[2]! });
  const result = toRgb({
    mode: "oklab",
    l: a.l + (b.l - a.l) * amount,
    a: a.a + (b.a - a.a) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
  return [result.r, result.g, result.b].map((channel) => Math.min(1, Math.max(0, channel)));
};

const hex = (color: Rgb) =>
  `#${color
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const luminance = (color: Rgb) =>
  color.reduce(
    (sum, value, index) =>
      sum +
      [0.2126, 0.7152, 0.0722][index]! *
        (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4),
    0,
  );
function composite(value: string, background: Rgb) {
  const alpha = value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1;
  return mixRgb(background, rgb(value), alpha);
}

export function sidebarContrast(a: string, b: string) {
  const background = rgb(b);
  const [light, dark] = [luminance(composite(a, background)), luminance(background)].sort(
    (x, y) => y - x,
  );
  return (light! + 0.05) / (dark! + 0.05);
}

const SURFACES = [
  "sidebar",
  "sidebarControlSurface",
  "sidebarRowHover",
  "sidebarRowActive",
  "sidebarRowSelected",
  "sidebarBorder",
] as const;
const FOREGROUNDS = [
  "sidebarForeground",
  "sidebarMutedForeground",
  "errorForeground",
  "warningForeground",
  "updateForeground",
] as const;

export function computeSidebarTint(
  colors: ThemeColors,
  color: string | null,
  protectedColors: readonly { color: string; minimum: number; token?: string }[] = [],
) {
  const background = composite(
    themeColorToHex(colors.sidebar) ?? "#000000",
    rgb(themeColorToHex(colors.canvas) ?? "#000000"),
  );
  let weight = color === null ? 0 : luminance(background) < 0.4 ? 240 : 180;
  const tint = rgb(color ?? hex(background));
  const bases = Object.fromEntries(
    SURFACES.map((role) => [
      role,
      hex(
        role === "sidebar"
          ? background
          : composite(themeColorToHex(colors[role]) ?? "#000000", background),
      ),
    ]),
  );
  const paint = (strength: number) => {
    const surfaces = Object.fromEntries(
      SURFACES.map((role) => [role, hex(mix(rgb(bases[role]!), tint, strength))]),
    );
    const textSurfaces = [
      ...SURFACES.slice(0, -1).map((role) => surfaces[role]!),
      hex(mix(background, [0, 0, 0], 0.12)),
      hex(mix(background, [1, 1, 1], 0.12)),
    ];
    return { surfaces, textSurfaces };
  };
  const bestContrast = (surfaces: string[]) =>
    Math.max(
      ...["#000000", "#ffffff"].map((text) =>
        Math.min(...surfaces.map((surface) => sidebarContrast(text, surface))),
      ),
    );
  let painted = paint(weight / 1000);
  while (weight > 0 && bestContrast(painted.textSurfaces) < 4.5) painted = paint(--weight / 1000);
  const strength = weight / 1000;
  const { surfaces, textSurfaces } = painted;
  const readable = (foreground: string, minimum: number) => {
    const contrast = (candidate: string) =>
      Math.min(...textSurfaces.map((surface) => sidebarContrast(candidate, surface)));
    if (contrast(foreground) >= minimum) return foreground;
    const target = contrast("#000000") > contrast("#ffffff") ? [0, 0, 0] : [1, 1, 1];
    for (let step = 1; step <= 100; step++) {
      const candidate = hex(mix(rgb(foreground), target, step / 100));
      if (contrast(candidate) >= minimum) return candidate;
    }
    return hex(target);
  };
  const variables: Record<string, string> = Object.fromEntries(
    SURFACES.map((role) => [
      `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      strength === 0
        ? bases[role]!
        : `color-mix(in oklab, ${bases[role]} ${(1 - strength) * 100}%, ${color} ${strength * 100}%)`,
    ]),
  );
  for (const role of FOREGROUNDS) {
    const foreground = readable(themeColorToHex(colors[role])?.slice(0, 7) ?? "#000000", 4.5);
    const key = `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    variables[key] = foreground;
    if (role === "sidebarForeground" || role === "sidebarMutedForeground")
      variables[`--contrast${key.slice(1)}`] = foreground;
  }
  for (const foreground of protectedColors) {
    if (foreground.token)
      variables[foreground.token] = readable(foreground.color.slice(0, 7), foreground.minimum);
  }
  variables["--sidebar-icon-color"] = readable(variables["--sidebar-muted-foreground"]!, 3);
  variables["--sidebar-neutral"] = hex(background);
  const cache = {
    ...variables,
    ...Object.fromEntries(
      SURFACES.map((role) => [
        `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
        surfaces[role]!,
      ]),
    ),
  };
  return { strength, variables, surfaces, cache };
}
