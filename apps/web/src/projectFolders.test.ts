import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ClientSettingsSchema, ClientSettingsPatch } from "@t3tools/contracts/settings";
import {
  arrangeProjectFolderTree,
  UNGROUPED_PROJECT_FOLDER_ID,
  deleteProjectFolder,
  moveProjectFolder,
  moveProjectsToFolder,
  placeProjectOrder,
  planSidebarTreeDrop,
  projectFolderAncestors,
  projectFolderPath,
  projectFolderTree,
  resolveSidebarTreeDropZone,
  suggestProjectFolders,
  type ProjectFolder,
} from "./projectFolders";

const decodeSettings = Schema.decodeSync(ClientSettingsSchema);
const encodeSettings = Schema.encodeSync(ClientSettingsSchema);
const decodePatch = Schema.decodeSync(ClientSettingsPatch);

const folders = [
  { id: "a", name: "StaffPass", emoji: "", projectKeys: ["mac:backend", "server:web"] },
  { id: "b", name: "Other", emoji: "📁", projectKeys: ["server:other"] },
];

function folder(id: string, name: string, projectKeys: string[]): ProjectFolder {
  return { id, name, emoji: "", projectKeys };
}

function describeRow(
  row: ReturnType<typeof arrangeProjectFolderTree<{ group: { projectKey: string } }>>[number],
) {
  return row.kind === "folder"
    ? `folder ${row.folder.id} ${row.depth}`
    : `${row.kind} ${row.project.group.projectKey} ${row.depth}`;
}

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

  it("lists groups before projects at every level, in stored group order", () => {
    const projects = ["server:other", "loose-b", "mac:backend", "loose-a", "server:web"].map(
      (projectKey) => ({ group: { projectKey } }),
    );
    const nested = [...folders, { ...folder("c", "Nested", ["loose-a"]), parentId: "a" }];
    const rows = arrangeProjectFolderTree(projects, nested, { isCollapsed: () => false });
    expect(rows.map(describeRow)).toEqual([
      "folder a 0",
      "folder c 1",
      "project loose-a 2",
      "project mac:backend 1",
      "project server:web 1",
      "folder b 0",
      "project server:other 1",
      "folder ungrouped 0",
      "project loose-b 1",
    ]);
    expect(rows[0]).toMatchObject({ projects: [projects[3], projects[2], projects[4]] });
    expect(arrangeProjectFolderTree(projects, [], { isCollapsed: () => false })).toEqual(
      projects.map((project) => ({ kind: "project", project, depth: 0, folderId: null })),
    );
  });

  it("hides everything below a collapsed group but counts its descendants", () => {
    const projects = ["mac:backend", "deep"].map((projectKey) => ({ group: { projectKey } }));
    const nested = [
      folder("a", "Top", ["mac:backend"]),
      { ...folder("c", "Mid", []), parentId: "a" },
      { ...folder("d", "Deep", ["deep"]), parentId: "c" },
    ];
    const rows = arrangeProjectFolderTree(projects, nested, { isCollapsed: (id) => id === "a" });
    expect(rows.map(describeRow)).toEqual(["folder a 0"]);
    expect(rows[0]).toMatchObject({ collapsed: true, projects: [projects[1], projects[0]] });
    const midCollapsed = arrangeProjectFolderTree(projects, nested, {
      isCollapsed: (id) => id === "c",
    });
    expect(midCollapsed.map(describeRow)).toEqual([
      "folder a 0",
      "folder c 1",
      "project mac:backend 1",
    ]);
    expect(midCollapsed[1]).toMatchObject({ projects: [projects[1]] });
  });

  it("drops empty groups only while a project filter is active", () => {
    const projects = [{ group: { projectKey: "loose" } }];
    const empty = [folder("a", "Empty", [])];
    expect(
      arrangeProjectFolderTree(projects, empty, { isCollapsed: () => false }).map(describeRow),
    ).toEqual(["folder a 0", "folder ungrouped 0", "project loose 1"]);
    expect(
      arrangeProjectFolderTree(projects, empty, {
        isCollapsed: () => false,
        includeEmpty: false,
      }).map(describeRow),
    ).toEqual(["folder ungrouped 0", "project loose 1"]);
  });

  it("keeps no-project threads loose and last, and omits empty virtual groups", () => {
    const projects = [
      { group: { projectKey: "scratch", isScratch: true } },
      { group: { projectKey: "assigned" } },
      { group: { projectKey: "loose" } },
    ];
    const groups = [folder("a", "A", ["assigned", "scratch"])];
    expect(
      arrangeProjectFolderTree(projects, groups, { isCollapsed: () => false }).map(describeRow),
    ).toEqual([
      "folder a 0",
      "project assigned 1",
      "folder ungrouped 0",
      "project loose 1",
      "loose scratch 0",
    ]);
    expect(
      arrangeProjectFolderTree(projects, groups, {
        isCollapsed: (id) => id === UNGROUPED_PROJECT_FOLDER_ID,
      }).map(describeRow),
    ).toEqual(["folder a 0", "project assigned 1", "folder ungrouped 0", "loose scratch 0"]);
    expect(
      arrangeProjectFolderTree(projects.slice(0, 2), groups, { isCollapsed: () => false }).map(
        describeRow,
      ),
    ).toEqual(["folder a 0", "project assigned 1", "loose scratch 0"]);
    expect(arrangeProjectFolderTree([], [], { isCollapsed: () => false })).toEqual([]);
    expect(
      arrangeProjectFolderTree([], groups, { isCollapsed: () => false }).map(describeRow),
    ).toEqual(["folder a 0"]);
  });

  it("reads missing parents and parent cycles as top level", () => {
    const broken = [
      { ...folder("a", "A", []), parentId: "b" },
      { ...folder("b", "B", []), parentId: "a" },
      { ...folder("c", "C", []), parentId: "gone" },
      { ...folder("d", "D", []), parentId: "d" },
    ];
    expect(projectFolderTree(broken).map(({ folder, depth }) => `${folder.id}${depth}`)).toEqual([
      "a0",
      "b1",
      "c0",
      "d0",
    ]);
  });

  it("nests, reorders and unnests groups without ever making one its own descendant", () => {
    const tree = [folder("a", "A", []), folder("b", "B", []), folder("c", "C", [])];
    const nested = moveProjectFolder(moveProjectFolder(tree, "b", { parentId: "a" }), "c", {
      parentId: "b",
    });
    expect(projectFolderPath(nested, "c")).toBe("A / B / C");
    expect(projectFolderAncestors(nested, "c")).toEqual(["b", "a"]);
    expect(moveProjectFolder(nested, "a", { parentId: "c" })).toEqual(nested);
    expect(moveProjectFolder(nested, "a", { parentId: "a" })).toEqual(nested);
    expect(moveProjectFolder(nested, "a", { parentId: "b", before: "c" })).toEqual(nested);
    const reordered = moveProjectFolder(
      [...tree, { ...folder("d", "D", []), parentId: "a" }],
      "c",
      { parentId: null, before: "a" },
    );
    expect(projectFolderTree(reordered).map(({ folder }) => folder.id)).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
    const after = moveProjectFolder(tree, "a", { parentId: null, after: "b" });
    expect(after.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    const unnested = moveProjectFolder(nested, "c", { parentId: null });
    expect(unnested.find((entry) => entry.id === "c")).not.toHaveProperty("parentId");
    expect(projectFolderTree(unnested).map(({ folder, depth }) => `${folder.id}${depth}`)).toEqual([
      "a0",
      "b1",
      "c0",
    ]);
  });

  it("promotes a deleted group's projects and subgroups to its parent in its place", () => {
    const tree: ProjectFolder[] = [
      folder("root", "Root", ["kept"]),
      { ...folder("first", "First", []), parentId: "root" },
      { ...folder("gone", "Gone", ["p1", "p2"]), parentId: "root" },
      { ...folder("child", "Child", ["p3"]), parentId: "gone" },
      { ...folder("last", "Last", []), parentId: "root" },
    ];
    const deleted = deleteProjectFolder(tree, "gone");
    expect(projectFolderTree(deleted).map(({ folder, depth }) => `${folder.id}${depth}`)).toEqual([
      "root0",
      "first1",
      "child1",
      "last1",
    ]);
    expect(deleted.find((entry) => entry.id === "root")?.projectKeys).toEqual(["kept", "p1", "p2"]);
    expect(deleted.find((entry) => entry.id === "child")?.projectKeys).toEqual(["p3"]);
    const topLevel = deleteProjectFolder(tree, "root");
    expect(topLevel.find((entry) => entry.id === "first")).not.toHaveProperty("parentId");
    expect(topLevel.flatMap((entry) => entry.projectKeys)).not.toContain("kept");
  });

  it("plans drops that keep groups among groups and projects among projects", () => {
    const tree = [
      folder("a", "A", ["in-a"]),
      { ...folder("b", "B", ["in-b"]), parentId: "a" },
      folder("c", "C", []),
    ];
    const plan = (
      item: Parameters<typeof planSidebarTreeDrop>[1],
      target: Parameters<typeof planSidebarTreeDrop>[2],
    ) => planSidebarTreeDrop(tree, item, target);
    const groupA = { kind: "folder", id: "a" } as const;
    const projectInB = { kind: "project", key: "in-b" } as const;
    expect(plan(groupA, { kind: "folder", id: "b", zone: "into" })).toEqual({ kind: "none" });
    expect(plan(groupA, { kind: "folder", id: "b", zone: "before" })).toEqual({ kind: "none" });
    expect(plan(groupA, { kind: "folder", id: "c", zone: "into" })).toEqual({
      kind: "move-folder",
      folderId: "a",
      to: { parentId: "c" },
    });
    expect(plan({ kind: "folder", id: "c" }, { kind: "folder", id: "b", zone: "after" })).toEqual({
      kind: "move-folder",
      folderId: "c",
      to: { parentId: "a", after: "b" },
    });
    expect(plan(groupA, { kind: "project", key: "in-a", zone: "before" })).toEqual({
      kind: "none",
    });
    expect(plan({ kind: "folder", id: "b" }, { kind: "root" })).toEqual({
      kind: "move-folder",
      folderId: "b",
      to: { parentId: null },
    });
    expect(plan(projectInB, { kind: "folder", id: "c", zone: "before" })).toEqual({
      kind: "move-project",
      projectKey: "in-b",
      folderId: "c",
    });
    expect(plan(projectInB, { kind: "folder", id: "b", zone: "into" })).toEqual({ kind: "none" });
    expect(plan(projectInB, { kind: "project", key: "in-a", zone: "after" })).toEqual({
      kind: "move-project",
      projectKey: "in-b",
      folderId: "a",
      anchor: { projectKey: "in-a", position: "after" },
    });
    expect(plan(projectInB, { kind: "project", key: "loose", zone: "before" })).toEqual({
      kind: "move-project",
      projectKey: "in-b",
      folderId: null,
      anchor: { projectKey: "loose", position: "before" },
    });
    expect(
      plan(projectInB, { kind: "folder", id: UNGROUPED_PROJECT_FOLDER_ID, zone: "into" }),
    ).toEqual({
      kind: "move-project",
      projectKey: "in-b",
      folderId: null,
    });
    expect(
      plan({ kind: "project", key: "loose" }, { kind: "folder", id: "a", zone: "into" }),
    ).toEqual({
      kind: "move-project",
      projectKey: "loose",
      folderId: "a",
    });
    expect(plan(groupA, { kind: "folder", id: UNGROUPED_PROJECT_FOLDER_ID, zone: "into" })).toEqual(
      { kind: "none" },
    );
    expect(
      plan(
        { kind: "folder", id: UNGROUPED_PROJECT_FOLDER_ID },
        { kind: "folder", id: "a", zone: "into" },
      ),
    ).toEqual({ kind: "none" });
    expect(plan(projectInB, { kind: "root" })).toEqual({
      kind: "move-project",
      projectKey: "in-b",
      folderId: null,
    });
    expect(plan({ kind: "project", key: "loose" }, { kind: "root" })).toEqual({ kind: "none" });
  });

  it("offers no insert line that would put a project beside a group", () => {
    expect(resolveSidebarTreeDropZone("project", { kind: "folder", expanded: false }, 0.05)).toBe(
      "into",
    );
    expect(resolveSidebarTreeDropZone("project", { kind: "project" }, 0.2)).toBe("before");
    expect(resolveSidebarTreeDropZone("project", { kind: "project" }, 0.8)).toBe("after");
    expect(resolveSidebarTreeDropZone("folder", { kind: "project" }, 0.5)).toBeNull();
    expect(resolveSidebarTreeDropZone("folder", { kind: "folder", expanded: false }, 0.1)).toBe(
      "before",
    );
    expect(resolveSidebarTreeDropZone("folder", { kind: "folder", expanded: false }, 0.5)).toBe(
      "into",
    );
    expect(resolveSidebarTreeDropZone("folder", { kind: "folder", expanded: false }, 0.9)).toBe(
      "after",
    );
    // An open group's lower edge sits above its children, not after its subtree.
    expect(resolveSidebarTreeDropZone("folder", { kind: "folder", expanded: true }, 0.9)).toBe(
      "into",
    );
  });

  it("places reordered projects before or after an anchor in the full order", () => {
    expect(placeProjectOrder(["a", "b", "c", "d"], ["a"], ["c"], "after")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(placeProjectOrder(["a", "b", "c", "d"], ["d", "x"], ["b"], "before")).toEqual([
      "a",
      "d",
      "x",
      "b",
      "c",
    ]);
    expect(placeProjectOrder(["a", "b"], ["a"], ["missing"], "before")).toEqual(["a", "b"]);
  });

  it("decodes old settings and round trips folder membership through settings and patches", () => {
    expect(decodeSettings({}).sidebarProjectFolders).toEqual([]);
    expect(decodeSettings({}).hideSidebarProjectIcons).toBe(false);
    expect(
      decodeSettings(encodeSettings(decodeSettings({ hideSidebarProjectIcons: true })))
        .hideSidebarProjectIcons,
    ).toBe(true);
    expect(decodePatch({ hideSidebarProjectIcons: true }).hideSidebarProjectIcons).toBe(true);
    const settings = decodeSettings({ sidebarProjectFolders: folders });
    expect(decodeSettings(encodeSettings(settings)).sidebarProjectFolders).toEqual(folders);
    expect(decodePatch({ sidebarProjectFolders: folders }).sidebarProjectFolders).toEqual(folders);
    const nested = [...folders, { ...folder("c", "Child", []), parentId: "a" }];
    expect(
      decodeSettings(encodeSettings(decodeSettings({ sidebarProjectFolders: nested })))
        .sidebarProjectFolders,
    ).toEqual(nested);
  });
});
