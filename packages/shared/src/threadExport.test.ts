import { parse } from "yaml";
import { OrchestrationV2ThreadTranscript } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  portableConversation,
  renderThreadExportMarkdown,
  threadExportPath,
  safeBackupName,
  limitThreadExport,
  matchImportProject,
  importPlacement,
} from "./threadExport.ts";

const decodeTranscript = Schema.decodeUnknownSync(
  Schema.toCodecJson(OrchestrationV2ThreadTranscript),
);

it("exports messages and plans without tool payloads or attachment bytes", () => {
  const base = {
    id: "item",
    threadId: "thread",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const transcript = decodeTranscript({
    threadId: "thread",
    title: "Test",
    updatedAt: base.updatedAt,
    items: [
      {
        type: "user_message",
        messageId: "msg",
        inputIntent: "turn_start",
        createdBy: "user",
        creationSource: "web",
        text: "Hello",
        attachments: [],
      },
      { type: "assistant_message", messageId: "reply", text: "World", streaming: false },
      { type: "proposed_plan", planId: "plan", markdown: "Do work", streaming: false },
      { type: "reasoning", text: "Private", streaming: false },
    ].map((item, position) => ({
      position,
      visibility: "local",
      sourceThreadId: "thread",
      sourceItemId: "item",
      item: { ...base, ...item },
    })),
  });
  const conversation = portableConversation(transcript);
  expect(conversation.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "user", text: "Hello" },
    { role: "assistant", text: "World" },
    { role: "plan", text: "Do work" },
  ]);
  const bundle = {
    format: "t3code.thread" as const,
    version: 1 as const,
    threadId: "abc/def",
    title: "../Hello",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: DateTime.formatIso(DateTime.makeUnsafe(0)),
    source: { environmentId: "mac", label: "Mac" },
    project: { title: "App", workspacePath: "/app" },
    provider: "codex",
    model: "test",
    conversation: [
      {
        role: "user" as const,
        text: "Hello\nworld",
        timestamp: "2026-01-01",
        attachments: [{ name: "photo.png" }],
      },
    ],
  };
  expect(renderThreadExportMarkdown(bundle)).toContain("Hello\nworld");
  expect(renderThreadExportMarkdown(bundle)).toContain("photo.png");
  expect(threadExportPath(bundle)).not.toContain("../");
  expect(renderThreadExportMarkdown(bundle)).toMatch(/^---\nt3_thread_id: "abc\/def"/);
  expect(renderThreadExportMarkdown(bundle)).toContain('tags: [t3code, "app"]');

  expect(safeBackupName(' []#^|:\\/?*<>" ')).not.toMatch(/[[\]#^|:\\/?*<>"]/);
  expect(safeBackupName("a".repeat(300))).toHaveLength(48);
  const markdown = renderThreadExportMarkdown({
    ...bundle,
    project: { ...bundle.project, title: 'A: "B"\nC' },
  });
  expect(parse(markdown.split("---")[1] ?? "")).toMatchObject({
    project: 'A: "B"\nC',
    t3_thread_id: bundle.threadId,
    workspace: "/app",
    created: bundle.createdAt,
  });
  const limited = limitThreadExport({
    ...bundle,
    conversation: [
      { ...bundle.conversation[0]!, text: "😀".repeat(2_500_000) },
      ...bundle.conversation,
    ],
  });
  expect(new TextEncoder().encode(JSON.stringify(limited)).length).toBeLessThan(10_000_000);
  expect(limited.conversation[0]?.text).toContain("omitted");
  expect(limited.conversation.at(-1)?.text).toBe("Hello\nworld");
});

describe("matchImportProject", () => {
  const erpKey = "github.com/xyz-solutions-tech/xyz-erp";
  const project = (
    id: string,
    title: string,
    workspaceRoot: string,
    canonicalKey: string | null,
    updatedAt = "2026-01-01T00:00:00Z",
  ) => ({
    id,
    title,
    workspaceRoot,
    updatedAt,
    repositoryIdentity: canonicalKey === null ? null : { canonicalKey },
  });
  const linux = [
    project("erp", "xyz-erp", "/home/t3/code/xyz-erp", erpKey),
    project("web", "Website", "/home/t3/code/site", "github.com/xyz/site"),
    project("scratch", "No project", "/home/t3/.t3/scratch", null),
  ];
  it.each([
    {
      name: "Mac path, same repository",
      source: {
        title: "XYZ ERP",
        workspacePath: "/Users/julio/xyz-erp",
        repository: { canonicalKey: erpKey },
      },
      candidates: linux,
      expected: ["erp", "repository"],
    },
    {
      name: "same workspace path without repository",
      source: { title: "Renamed", workspacePath: "/home/t3/code/site" },
      candidates: linux,
      expected: ["web", "path"],
    },
    {
      name: "old export without repository falls back to title",
      source: { title: "  website ", workspacePath: "/Users/julio/site" },
      candidates: linux,
      expected: ["web", "title"],
    },
    {
      name: "no-project chats go to the scratch project by title",
      source: { title: "No project", workspacePath: "" },
      candidates: linux,
      expected: ["scratch", "title"],
    },
    {
      name: "nothing matches",
      source: {
        title: "Unknown",
        workspacePath: "/Users/julio/unknown",
        repository: { canonicalKey: "github.com/other/repo" },
      },
      candidates: linux,
      expected: null,
    },
    {
      name: "two repository matches prefer the matching title",
      source: {
        title: "xyz-erp",
        workspacePath: "/Users/j/erp",
        repository: { canonicalKey: erpKey },
      },
      candidates: [
        project("worktree", "erp-hotfix", "/home/t3/wt/erp", erpKey, "2026-06-01T00:00:00Z"),
        project("erp", "xyz-erp", "/home/t3/code/xyz-erp", erpKey),
      ],
      expected: ["erp", "repository"],
    },
    {
      name: "two repository matches without a title match prefer the most recent",
      source: { title: "ERP", workspacePath: "/Users/j/erp", repository: { canonicalKey: erpKey } },
      candidates: [
        project("old", "erp-a", "/home/t3/a", erpKey, "2026-01-01T00:00:00Z"),
        project("new", "erp-b", "/home/t3/b", erpKey, "2026-06-01T00:00:00Z"),
      ],
      expected: ["new", "repository"],
    },
  ])("$name", ({ source, candidates, expected }) => {
    const match = matchImportProject(source, candidates);
    expect(match === null ? null : [match.project.id, match.rule]).toEqual(expected);
  });
});

it.each([
  { name: "new chat", existing: undefined, matched: "erp", expected: "imported" },
  {
    name: "misplaced in fallback",
    existing: { projectId: "fallback", deleted: false },
    matched: "erp",
    expected: "move",
  },
  {
    name: "moved elsewhere by the user",
    existing: { projectId: "web", deleted: false },
    matched: "erp",
    expected: "present",
  },
  {
    name: "already in its project",
    existing: { projectId: "erp", deleted: false },
    matched: "erp",
    expected: "present",
  },
  {
    name: "no better project",
    existing: { projectId: "fallback", deleted: false },
    matched: null,
    expected: "present",
  },
  {
    name: "deleted import",
    existing: { projectId: "fallback", deleted: true },
    matched: "erp",
    expected: "present",
  },
] as const)("importPlacement: $name", ({ existing, matched, expected }) => {
  expect(
    importPlacement({ existing, fallbackProjectId: "fallback", matchedProjectId: matched }),
  ).toBe(expected);
});
