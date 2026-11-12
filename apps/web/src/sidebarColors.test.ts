import { describe, expect, it } from "vite-plus/test";
import {
  computeSidebarTint,
  resolveSidebarColor,
  sidebarContrast,
  SIDEBAR_COLORS,
} from "./sidebarColors";
import {
  getStandardPaintedThemeColors,
  getThemeDefinition,
  getThemeColorsForMode,
  themeColorToHex,
} from "./themePalette";
import { projectFolderColor } from "./projectFolders";

it("resolves the project before the nearest coloured ancestor and default", () => {
  const folders = [
    { id: "root", name: "Root", emoji: "", projectKeys: [], sidebarColor: "#629bd7" },
    { id: "child", name: "Child", emoji: "", projectKeys: ["project"], parentId: "root" },
    {
      id: "nested",
      name: "Nested",
      emoji: "",
      projectKeys: [],
      parentId: "child",
      sidebarColor: "#cc7ca5",
    },
  ];
  expect(projectFolderColor(folders, "child")).toBe("#629bd7");
  expect(projectFolderColor(folders, "nested")).toBe("#cc7ca5");
  expect(resolveSidebarColor("#123456", projectFolderColor(folders, "child"))).toBe("#123456");
  expect(projectFolderColor(folders, undefined)).toBeNull();
  expect(resolveSidebarColor(null, null)).toBeNull();
});

describe("visible Oklab sidebar washes", () => {
  it.each(["light", "dark"] as const)(
    "keeps body and muted text at AA across every picker colour in %s",
    (appearance) => {
      const themes = [
        getStandardPaintedThemeColors(appearance),
        ...["claude", "ocean", "grove", "ember", "iris"].flatMap((id) => {
          const theme = getThemeDefinition(id);
          return theme ? [getThemeColorsForMode(theme, appearance) ?? theme.colors] : [];
        }),
      ];
      for (const theme of themes) {
        for (const color of [
          ...SIDEBAR_COLORS.map((color) => color.value),
          "#000000",
          "#ffffff",
          "#00ff00",
          "#ff00ff",
          "#0000ff",
        ]) {
          const result = computeSidebarTint(theme, color);
          expect(result.strength).toBeGreaterThanOrEqual(0.18);
          expect(result.strength).toBeLessThanOrEqual(0.24);
          expect(result.variables["--sidebar"]).toContain("color-mix(in oklab");
          for (const foreground of [
            "--contrast-sidebar-foreground",
            "--contrast-sidebar-muted-foreground",
          ]) {
            for (const surface of [
              "sidebar",
              "sidebarControlSurface",
              "sidebarRowHover",
              "sidebarRowActive",
              "sidebarRowSelected",
            ]) {
              expect(
                sidebarContrast(result.variables[foreground]!, result.surfaces[surface]!),
                JSON.stringify({
                  base: theme.sidebar,
                  selected: theme.sidebarRowSelected,
                  color,
                  foreground,
                  surface,
                  solved: result.variables[foreground],
                  filled: result.surfaces[surface],
                }),
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
          expect(result.surfaces.sidebarRowSelected).not.toBe(result.surfaces.sidebar);
        }
      }
    },
  );

  it("keeps neutral backgrounds exact when tint is disabled and composites translucent row fills", () => {
    const theme = {
      ...getStandardPaintedThemeColors("dark"),
      sidebar: "#101010",
      sidebarRowHover: "#ffffff00",
    };
    const result = computeSidebarTint(theme, null);
    expect(result.strength).toBe(0);
    expect(result.variables["--sidebar"]).toBe("#101010");
    expect(result.surfaces.sidebarRowHover).toBe(result.surfaces.sidebar);
    expect(computeSidebarTint(theme, "#629bd7").surfaces.sidebar).not.toBe(
      themeColorToHex(theme.sidebar),
    );
  });
});
