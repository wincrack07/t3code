import { describe, expect, it } from "vite-plus/test";
import {
  computeSidebarTint,
  resolveSidebarColor,
  sidebarContrast,
  SIDEBAR_COLORS,
} from "./sidebarColors";
import {
  getStandardPaintedThemeColors,
  themeColorToHex,
  getThemeDefinition,
  getThemeColorsForMode,
} from "./themePalette";

it("resolves project before group and default, including explicit resets", () => {
  expect(resolveSidebarColor("#123456", "#654321")).toBe("#123456");
  expect(resolveSidebarColor(null, "#654321")).toBe("#654321");
  expect(resolveSidebarColor(undefined, null)).toBeNull();
});

describe("sidebar tint contrast", () => {
  it.each(["light", "dark"] as const)(
    "clamps every palette and extreme custom colour in %s themes",
    (appearance) => {
      const themes = [
        getStandardPaintedThemeColors(appearance),
        ...["claude", "ocean", "grove", "ember", "iris"].flatMap((id) => {
          const theme = getThemeDefinition(id);
          return theme ? [getThemeColorsForMode(theme, appearance) ?? theme.colors] : [];
        }),
      ];
      let tinted = 0;
      for (const theme of themes) {
        for (const color of [
          ...SIDEBAR_COLORS.map((color) => color.value),
          "#ffffff",
          "#000000",
          "#00ff00",
          "#ff00ff",
          "#0000ff",
        ]) {
          const protectedColors = [
            { color: appearance === "dark" ? "#60a5fa" : "#1d4ed8", minimum: 4.5 },
            { color: appearance === "dark" ? "#aaaaaa" : "#777777", minimum: 3 },
          ];
          const result = computeSidebarTint(theme, color, protectedColors);
          expect(result.strength).toBeGreaterThanOrEqual(0);
          expect(result.strength).toBeLessThanOrEqual(0.08);
          if (result.strength > 0) tinted++;
          for (const role of [
            "sidebarForeground",
            "sidebarMutedForeground",
            "errorForeground",
            "warningForeground",
            "updateForeground",
          ] as const) {
            const foreground = themeColorToHex(theme[role])!.slice(0, 7);
            for (const surface of [
              "sidebar",
              "sidebarControlSurface",
              "sidebarRowHover",
              "sidebarRowActive",
              "sidebarRowSelected",
            ] as const) {
              const variable = `--${surface.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
              const baseline = sidebarContrast(
                foreground,
                themeColorToHex(theme[surface])!.slice(0, 7),
              );
              expect(
                sidebarContrast(foreground, result.variables[variable]!) + 0.000001,
              ).toBeGreaterThanOrEqual(Math.min(4.5, baseline));
            }
          }
          for (const foreground of protectedColors) {
            const baseline = sidebarContrast(
              foreground.color,
              themeColorToHex(theme.sidebar)!.slice(0, 7),
            );
            expect(
              sidebarContrast(foreground.color, result.variables["--sidebar"]!) + 0.000001,
            ).toBeGreaterThanOrEqual(Math.min(foreground.minimum, baseline));
          }
        }
      }
      expect(tinted).toBeGreaterThan(0);
    },
  );

  it("composites translucent row fills over the sidebar before tinting", () => {
    const theme = {
      ...getStandardPaintedThemeColors("dark"),
      sidebar: "#101010",
      sidebarRowHover: "#ffffff00",
    };
    const result = computeSidebarTint(theme, "#629bd7");
    expect(result.variables["--sidebar-row-hover"]).toBe(result.variables["--sidebar"]);
  });

  it("leaves the surface unchanged when the original text is already at its contrast limit", () => {
    const theme = {
      ...getStandardPaintedThemeColors("light"),
      sidebar: "#ffffff",
      sidebarMutedForeground: "#777777",
    };
    expect(computeSidebarTint(theme, "#000000").variables["--sidebar"]).toBe("#ffffff");
  });
});
