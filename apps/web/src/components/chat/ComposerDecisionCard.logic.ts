import type { ComposerThreadDraftState } from "../../composerDraftStore";

type DraftContent = Pick<
  ComposerThreadDraftState,
  | "prompt"
  | "images"
  | "files"
  | "terminalContexts"
  | "previewAnnotations"
  | "reviewComments"
  | "threadContexts"
  | "environmentContexts"
>;

/** Mod+Enter picks the primary answer only while the composer holds nothing to send. */
export function isDecisionShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing">,
  options: { readonly mac: boolean; readonly draft: DraftContent | null },
): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return false;
  if (!(options.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
    return false;
  }
  const draft = options.draft;
  return (
    draft === null ||
    (draft.prompt.trim().length === 0 &&
      draft.images.length === 0 &&
      draft.files.length === 0 &&
      draft.terminalContexts.length === 0 &&
      draft.previewAnnotations.length === 0 &&
      draft.reviewComments.length === 0 &&
      draft.threadContexts.length === 0 &&
      draft.environmentContexts.length === 0)
  );
}
