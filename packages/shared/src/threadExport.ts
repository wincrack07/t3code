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

export interface ImportProjectCandidate {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly updatedAt: string;
  readonly repositoryIdentity?: { readonly canonicalKey: string } | null | undefined;
}

export type ImportProjectRule = "repository" | "path" | "title";

const sameTitle = (a: string, b: string) => {
  const left = a.trim().toLowerCase();
  return left !== "" && left === b.trim().toLowerCase();
};

/** Repository, then workspace path, then title; null means the user's picked destination. */
export function matchImportProject<P extends ImportProjectCandidate>(
  source: T3ThreadExport["project"],
  candidates: ReadonlyArray<P>,
): { readonly project: P; readonly rule: ImportProjectRule } | null {
  const key = source.repository?.canonicalKey.trim().toLowerCase();
  const rules: ReadonlyArray<readonly [ImportProjectRule, (project: P) => boolean]> = [
    [
      "repository",
      (project) => !!key && project.repositoryIdentity?.canonicalKey.trim().toLowerCase() === key,
    ],
    [
      "path",
      (project) => source.workspacePath !== "" && project.workspaceRoot === source.workspacePath,
    ],
    ["title", (project) => sameTitle(source.title, project.title)],
  ];
  for (const [rule, matches] of rules) {
    const found = candidates.filter(matches);
    if (found.length === 0) continue;
    const project = found.reduce((best, next) =>
      (Number(sameTitle(source.title, next.title)) - Number(sameTitle(source.title, best.title)) ||
        next.updatedAt.localeCompare(best.updatedAt)) > 0
        ? next
        : best,
    );
    return { project, rule };
  }
  return null;
}

export type ImportPlacement = "imported" | "present" | "move";

/**
 * Only a chat still sitting in the picked fallback moves: one the user moved elsewhere stays put.
 */
export function importPlacement(input: {
  readonly existing?: { readonly projectId: string; readonly deleted: boolean } | undefined;
  readonly fallbackProjectId: string;
  readonly matchedProjectId: string | null;
}): ImportPlacement {
  const { existing, fallbackProjectId, matchedProjectId } = input;
  if (existing === undefined) return "imported";
  return !existing.deleted &&
    existing.projectId === fallbackProjectId &&
    matchedProjectId !== null &&
    matchedProjectId !== fallbackProjectId
    ? "move"
    : "present";
}
