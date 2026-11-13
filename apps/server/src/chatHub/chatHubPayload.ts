import type { T3ThreadExportResult } from "@t3tools/contracts";
import { renderThreadExportMarkdown } from "@t3tools/shared/threadExport";

export function chatHubPayload(exported: T3ThreadExportResult, updatedAt: string) {
  let bundle = { ...exported.bundle, updatedAt };
  const meta = { ...exported.meta, updatedAt };
  let payload = { meta, bundle, markdown: renderThreadExportMarkdown(bundle) };
  let conversation = [...bundle.conversation];
  // The Worker limits the entire request, including both copies of conversation text.
  while (Buffer.byteLength(JSON.stringify(payload)) > 10_400_000 && conversation.length > 0) {
    conversation = conversation.slice(Math.max(1, Math.floor(conversation.length / 2)));
    bundle = {
      ...bundle,
      conversation: [
        {
          role: "plan",
          text: "Earlier conversation omitted to fit the chat hub upload limit.",
          timestamp: bundle.createdAt,
          attachments: [],
        },
        ...conversation,
      ],
    };
    payload = { meta, bundle, markdown: renderThreadExportMarkdown(bundle) };
  }
  return payload;
}
