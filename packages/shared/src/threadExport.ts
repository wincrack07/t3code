import { ThreadId } from "@t3tools/contracts";
import { sha256 } from "@noble/hashes/sha2";
import * as Hex from "effect/encoding/Hex";
import type { OrchestrationV2ThreadTranscript, T3ThreadExport } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function portableConversation(
  transcript: Pick<OrchestrationV2ThreadTranscript, "items">,
): T3ThreadExport["conversation"] {
  return transcript.items.flatMap<T3ThreadExport["conversation"][number]>(({ item }) => {
    const timestamp = DateTime.formatIso(item.startedAt ?? item.updatedAt);
    if (item.type === "user_message" || item.type === "assistant_message") {
      return [
        {
          role: item.type === "user_message" ? ("user" as const) : ("assistant" as const),
          text: item.text,
          timestamp,
          attachments: (item.attachments ?? []).map(({ name }) => ({ name })),
        },
      ];
    }
    if (item.type === "proposed_plan" || item.type === "todo_list") {
      const text =
        item.type === "proposed_plan"
          ? item.markdown
          : item.steps
              .map((step) => `- [${step.status === "completed" ? "x" : " "}] ${step.text}`)
              .join("\n");
      return [{ role: "plan" as const, text, timestamp, attachments: [] }];
    }
    return [];
  });
}

export function safeBackupName(value: string): string {
  return (
    value
      .normalize("NFC")
      .replace(/[[\]#^|:\\/?*<>"\u0000-\u001f\u007f]/g, "_")
      .replace(/^\.+|[. ]+$/g, "")
      .trim()
      .slice(0, 48)
      .trim() || "Untitled"
  );
}

export function threadExportPath(bundle: T3ThreadExport): string {
  const shortId = Hex.encode(sha256(new TextEncoder().encode(bundle.threadId))).slice(0, 12);
  const environmentId = Hex.encode(
    sha256(new TextEncoder().encode(bundle.source.environmentId)),
  ).slice(0, 8);
  return `${safeBackupName(bundle.source.label)} ${environmentId}/${safeBackupName(bundle.project.title)}/${bundle.createdAt.slice(0, 10)} ${safeBackupName(bundle.title)} ${shortId}`;
}

export function renderThreadExportMarkdown(bundle: T3ThreadExport): string {
  const slug =
    bundle.project.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const fields = {
    t3_thread_id: bundle.threadId,
    t3_environment: bundle.source.label,
    project: bundle.project.title,
    workspace: bundle.project.workspacePath,
    provider: bundle.provider,
    model: bundle.model,
    created: bundle.createdAt,
    updated: bundle.updatedAt,
  };
  const header = Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${header}\ntags: [t3code, ${JSON.stringify(slug)}]\n---\n\n# ${bundle.title}\n\n${bundle.conversation.map((message) => `## ${message.role === "plan" ? "Plan" : message.role === "user" ? "User" : "Assistant"} · ${message.timestamp}\n\n${message.text}${message.attachments.length ? `\n\nAttachments (metadata only): ${message.attachments.map((a) => a.name).join(", ")}` : ""}`).join("\n\n")}\n`;
}

export function limitThreadExport(bundle: T3ThreadExport): T3ThreadExport {
  const conversation = [...bundle.conversation];
  let size = new TextEncoder().encode(JSON.stringify(bundle)).length;
  let removed = 0;
  while (size >= 9_900_000 && removed < conversation.length) {
    const item = conversation[removed++];
    size -= new TextEncoder().encode(JSON.stringify(item)).length;
  }
  const kept = conversation.slice(removed);
  if (removed > 0)
    kept.unshift({
      role: "plan",
      text: "Earlier conversation omitted to keep this export below 10 MB.",
      timestamp: bundle.createdAt,
      attachments: [],
    });
  return { ...bundle, conversation: kept };
}

export function portableImportThreadId(bundle: Pick<T3ThreadExport, "threadId" | "source">) {
  return ThreadId.make(
    `import-${Hex.encode(sha256(new TextEncoder().encode(JSON.stringify([bundle.source.environmentId, bundle.threadId]))))}`,
  );
}
