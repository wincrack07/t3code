import { parse } from "yaml";
import { OrchestrationV2ThreadTranscript } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  portableConversation,
  renderThreadExportMarkdown,
  threadExportPath,
  safeBackupName,
  limitThreadExport,
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
