import { describe, expect, it } from "vite-plus/test";

import { resolveReducedMotion } from "./reducedMotion.ts";

describe("resolveReducedMotion", () => {
  it.each([
    ["system", false, false],
    ["system", true, true],
    ["reduced", false, true],
    ["reduced", true, true],
    ["full", false, false],
    ["full", true, false],
  ] as const)("%s with OS reduce=%s resolves to reduced=%s", (preference, system, expected) => {
    expect(resolveReducedMotion(preference, system)).toBe(expected);
  });
});
