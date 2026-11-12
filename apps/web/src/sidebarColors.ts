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
const mix = (base: Rgb, tint: Rgb, strength: number) =>
  base.map((value, index) => value + (tint[index]! - value) * strength);
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
  return mix(background, rgb(value), alpha);
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
  color: string,
  protectedColors: readonly { color: string; minimum: number }[] = [],
) {
  const background = composite(
    themeColorToHex(colors.sidebar) ?? "#000000",
    rgb(themeColorToHex(colors.canvas) ?? "#000000"),
  );
  const parsed = Object.fromEntries([
    ...SURFACES.map((role) => [
      role,
      hex(
        role === "sidebar"
          ? background
          : composite(themeColorToHex(colors[role]) ?? "#000000", background),
      ),
    ]),
    ...FOREGROUNDS.map((role) => [role, themeColorToHex(colors[role]) ?? "#000000"]),
  ]);
  const tint = rgb(color);
  const desired = luminance(background) < 0.4 ? 0.08 : 0.06;
  // Existing themes can start below AA. Never reduce their contrast further.
  const foregrounds = [
    ...FOREGROUNDS.map((role) => ({ color: parsed[role]!, minimum: 4.5 })),
    ...protectedColors,
  ];
  const floors = foregrounds.map((foreground) =>
    SURFACES.slice(0, -1).map((surface) =>
      Math.min(foreground.minimum, sidebarContrast(foreground.color, parsed[surface]!)),
    ),
  );
  const safe = (strength: number) =>
    foregrounds.every((foreground, index) =>
      SURFACES.slice(0, -1).every(
        (surface, surfaceIndex) =>
          sidebarContrast(foreground.color, hex(mix(rgb(parsed[surface]!), tint, strength))) +
            0.000001 >=
          floors[index]![surfaceIndex]!,
      ),
    );
  let strength = desired;
  while (strength > 0 && !safe(strength)) strength = Math.max(0, strength - 0.001);
  const variables = Object.fromEntries(
    SURFACES.map((role) => [
      `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      hex(mix(rgb(parsed[role]!), tint, strength)),
    ]),
  );
  return { strength, variables };
}
