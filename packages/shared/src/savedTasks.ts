import type { ProjectSavedPrompt } from "@t3tools/contracts";
import { serializeComposerFileLink } from "./composerTrigger.ts";
export function savedTaskDraftContent(task: ProjectSavedPrompt) {
  const references = (task.attachments ?? []).flatMap((item) =>
    item.kind === "reference" ? [serializeComposerFileLink(item.path)] : [],
  );
  return {
    title: task.title ?? task.text.split("\n")[0]!.slice(0, 160),
    text: [task.text, ...references].join("\n\n"),
    attachments: (task.attachments ?? []).flatMap((item) =>
      item.kind === "stored" ? [item.attachment] : [],
    ),
  };
}
