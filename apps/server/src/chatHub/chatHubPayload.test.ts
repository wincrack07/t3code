import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId, type T3ThreadExportResult } from "@t3tools/contracts";
import { chatHubPayload } from "./chatHubPayload.ts";
it("keeps the combined bundle and Markdown inside the Worker's ten MiB limit", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const exported: T3ThreadExportResult = {
    bundle: {
      format: "t3code.thread",
      version: 1,
      threadId: ThreadId.make("thread"),
      title: "Chat",
      source: { environmentId: EnvironmentId.make("env"), label: "Machine" },
      createdAt: at,
      updatedAt: at,
      provider: "codex",
      model: "test",
      project: { title: "Project", workspacePath: "/work" },
      conversation: [
        { role: "user", text: "x".repeat(6_000_000), timestamp: at, attachments: [] },
        { role: "assistant", text: "Newest message", timestamp: at, attachments: [] },
      ],
    },
    meta: {
      environmentId: EnvironmentId.make("env"),
      environmentLabel: "Machine",
      threadId: ThreadId.make("thread"),
      title: "Chat",
      projectTitle: "Project",
      workspaceRoot: "/work",
      provider: "codex",
      model: "test",
      createdAt: at,
      updatedAt: at,
      archived: false,
      deletedAt: null,
      messageCount: 2,
    },
  };
  const payload = chatHubPayload(exported, at);
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(10_485_760);
  expect(payload.bundle.conversation.at(-1)?.text).toBe("Newest message");
  expect(payload.bundle.conversation[0]?.text).toContain("omitted");
  expect(payload.meta.messageCount).toBe(2);
});
