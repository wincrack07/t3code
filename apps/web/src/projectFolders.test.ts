import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ClientSettingsSchema, ClientSettingsPatch } from "@t3tools/contracts/settings";
import {
  arrangeProjectFolders,
  moveProjectsToFolder,
  suggestProjectFolders,
} from "./projectFolders";

const decodeSettings = Schema.decodeSync(ClientSettingsSchema);
const encodeSettings = Schema.encodeSync(ClientSettingsSchema);
const decodePatch = Schema.decodeSync(ClientSettingsPatch);

const folders = [
  { id: "a", name: "StaffPass", emoji: "", projectKeys: ["mac:backend", "server:web"] },
  { id: "b", name: "Other", emoji: "📁", projectKeys: ["server:other"] },
];

describe("project folders", () => {
  it("moves across environments, removes membership and releases projects on deletion", () => {
    const moved = moveProjectsToFolder(folders, ["mac:backend", "server:web"], "b");
    expect(moved.map((folder) => folder.projectKeys)).toEqual([
      [],
      ["server:other", "mac:backend", "server:web"],
    ]);
    expect(moveProjectsToFolder(moved, ["mac:backend"], null)[1]?.projectKeys).toEqual([
      "server:other",
      "server:web",
    ]);
    expect(moveProjectsToFolder(folders, ["mac:backend"], "missing")).toEqual(folders);
    const projects = ["mac:backend", "server:web", "server:other"].map((projectKey) => ({
      group: { projectKey },
    }));
    expect(
      arrangeProjectFolders(
        projects,
        folders.filter((folder) => folder.id !== "a"),
      ).map((entry) => entry.kind),
    ).toEqual(["project", "project", "folder"]);
    expect(folders[0]?.projectKeys).toEqual(["mac:backend", "server:web"]);
  });

  it("suggests only repeated separator prefixes on unassigned projects", () => {
    const projects = [
      "StaffPass: Backend",
      "staffpass · Website",
      "StaffPass - Mobile",
      "Solo: Backend",
      "StaffPassage",
      " - Invalid",
    ].map((displayName, index) => ({ displayName, projectKey: String(index) }));
    expect(suggestProjectFolders(projects, [])).toEqual([
      { name: "StaffPass", projectKeys: ["0", "1", "2"] },
    ]);
    expect(suggestProjectFolders(projects, [{ ...folders[0]!, projectKeys: ["0", "1"] }])).toEqual(
      [],
    );
  });

  it("anchors groups to their first sorted member, preserving pinned and manual order", () => {
    const projects = ["server:other", "mac:backend", "ungrouped", "server:web"].map(
      (projectKey) => ({ group: { projectKey } }),
    );
    const arranged = arrangeProjectFolders(projects, folders);
    expect(
      arranged.map((entry) =>
        entry.kind === "folder" ? entry.folder.id : entry.project.group.projectKey,
      ),
    ).toEqual(["b", "a", "ungrouped"]);
    expect(arranged[1]).toMatchObject({ projects: [projects[1], projects[3]] });
    expect(arrangeProjectFolders(projects, [])).toEqual(
      projects.map((project) => ({ kind: "project", project })),
    );
  });

  it("decodes old settings and round trips folder membership through settings and patches", () => {
    expect(decodeSettings({}).sidebarProjectFolders).toEqual([]);
    const settings = decodeSettings({ sidebarProjectFolders: folders });
    expect(decodeSettings(encodeSettings(settings)).sidebarProjectFolders).toEqual(folders);
    expect(decodePatch({ sidebarProjectFolders: folders }).sidebarProjectFolders).toEqual(folders);
  });
});
