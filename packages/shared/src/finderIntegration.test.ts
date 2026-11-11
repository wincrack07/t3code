import { describe, expect, it } from "vite-plus/test";
import { finderProjectForPaths, readFinderLink } from "./finderIntegration.ts";

describe("Finder selection", () => {
  it("decodes each argument without treating filenames as code", () => {
    const paths = [
      "/tmp/a b",
      "/tmp/\"quote'",
      "/tmp/line\nbreak",
      "/tmp/$(touch nope)",
      "/tmp/é#?%",
    ];
    const url = new URL("t3code://finder");
    for (const path of paths) url.searchParams.append("path", path);
    expect(readFinderLink(url.href)).toEqual(paths);
    for (const bad of [
      "https://finder?path=/tmp/a",
      "t3code://finder?path=relative",
      "t3code://finder?path=%00",
      "t3code://finder?path=/tmp/a&other=x",
      "t3code://finder",
      "t3code://finder/other?path=/tmp/a",
      "t3code://user@finder?path=/tmp/a",
    ])
      expect(readFinderLink(bad)).toBeNull();
    expect(
      readFinderLink(
        `t3code://finder?${Array.from({ length: 101 }, (_, i) => `path=/tmp/${i}`).join("&")}`,
      ),
    ).toBeNull();
  });
  it("chooses the deepest containing project on directory boundaries", () => {
    const projects = [{ workspaceRoot: "/work" }, { workspaceRoot: "/work/nested/" }];
    expect(finderProjectForPaths(["/work/nested/a"], projects)).toBe(projects[1]);
    expect(finderProjectForPaths(["/work/nested/a", "/work/b"], projects)).toBe(projects[0]);
    expect(finderProjectForPaths(["/workspace/a"], projects)).toBeNull();
    expect(finderProjectForPaths(["/outside/a"], projects)).toBeNull();
  });
});
