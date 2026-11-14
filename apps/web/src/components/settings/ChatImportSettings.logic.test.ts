import { expect, it } from "vite-plus/test";

import {
  chatIncluded,
  emptyDraft,
  foldersReady,
  importFileLabel,
  importProgressLabel,
  markChatsDone,
  mergeDestinations,
  NEW_PROJECT,
  parseStoredDraft,
  projectQueryMatches,
  projectSelection,
  remainingChats,
  serializeDraft,
  setAllProjects,
  toggleChat,
  toggleProject,
} from "./ChatImportSettings.logic";

const destinations = { erp: NEW_PROJECT, site: "existing-site" };
const draft = emptyDraft(destinations, "~/Projects");
const chats = [
  { id: "erp-1", projectKey: "erp" },
  { id: "erp-2", projectKey: "erp" },
  { id: "site-1", projectKey: "site" },
];

it("selects projects and individual chats, then resumes past finished ones", () => {
  expect(projectSelection(draft, "erp", ["erp-1", "erp-2"])).toBe("all");
  const withoutErp = toggleProject(draft, "erp", ["erp-1", "erp-2"]);
  expect(projectSelection(withoutErp, "erp", ["erp-1", "erp-2"])).toBe("none");
  expect(remainingChats(chats, withoutErp).map((chat) => chat.id)).toEqual(["site-1"]);

  const oneChat = toggleChat(withoutErp, "erp", "erp-1", ["erp-1", "erp-2"]);
  expect(projectSelection(oneChat, "erp", ["erp-1", "erp-2"])).toBe("some");
  expect(chatIncluded(oneChat, "erp", "erp-2")).toBe(false);
  const both = toggleChat(oneChat, "erp", "erp-2", ["erp-1", "erp-2"]);
  expect(projectSelection(both, "erp", ["erp-1", "erp-2"])).toBe("all");

  const done = markChatsDone(both, ["erp-1"]);
  expect(remainingChats(chats, done).map((chat) => chat.id)).toEqual(["erp-2", "site-1"]);
  expect(projectSelection(done, "erp", ["erp-1", "erp-2"])).toBe("all");
  expect(setAllProjects(done, ["erp", "site"], false).skippedProjects).toEqual(
    new Set(["erp", "site"]),
  );
});

it("keeps a saved plan only for the same backup and the same known projects", () => {
  const stored = serializeDraft("backup", "chats.zip", {
    ...draft,
    step: 2,
    skippedProjects: new Set(["site"]),
    doneChats: new Set(["erp-1"]),
  });
  expect(parseStoredDraft(stored, "other")).toBeNull();
  const restored = parseStoredDraft(stored, "backup");
  expect(restored?.step).toBe(2);
  expect(restored?.doneChats.has("erp-1")).toBe(true);
  expect(
    mergeDestinations(
      [
        { key: "erp", project: null },
        { key: "site", project: { id: "existing-site" } },
        { key: "new", project: null },
      ],
      restored?.destinations,
      new Set(["existing-site"]),
    ),
  ).toEqual({ erp: NEW_PROJECT, site: "existing-site", new: NEW_PROJECT });
  expect(
    foldersReady(
      draft,
      [{ key: "erp" }, { key: "site" }],
      chats.map((chat) => ({
        ...chat,
        title: chat.id,
        projectTitle: chat.projectKey,
        sourcePath: "",
      })),
      new Set(["existing-site"]),
    ),
  ).toBe(true);
  expect(
    foldersReady({ ...draft, baseDirectory: "Projects" }, [{ key: "erp" }], chats, new Set()),
  ).toBe(false);
});

it("matches a project by its name, path, or one of its chats", () => {
  expect(projectQueryMatches("ERP", "/work/erp", ["Fix invoices"], "invoice")).toBe(true);
  expect(projectQueryMatches("ERP", "/work/erp", ["Fix invoices"], "website")).toBe(false);
  expect(importFileLabel(["backup.zip"])).toBe("backup.zip");
  expect(importFileLabel(["a.json", "b.json"])).toBe("2 files");
  expect(importProgressLabel({ imported: 2, present: 1, moved: 0 })).toBe(
    "Imported 2 · 1 already present",
  );
});
