import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { SavedTaskLinkReceipt } from "@t3tools/client-runtime/state/tasks";
import {
  type ChatAttachment,
  type EnvironmentId,
  isProviderSendTurnSupportedImageMimeType,
  type TaskAttachmentInput,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../composerDraftStore";
import { readFileAsDataUrl } from "../lib/imageCompression";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseAttachmentUpload,
  startAttachmentUpload,
} from "../lib/attachmentUploadQueue";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { assetEnvironment } from "./assets";
import { readPreparedConnection } from "./session";

/** Starts whose thread could not be linked to its task, by task key, until a retry lands. */
export const taskLinkReceiptsAtom = Atom.make<Readonly<Record<string, SavedTaskLinkReceipt>>>(
  {},
).pipe(Atom.keepAlive, Atom.withLabel("web-task-link-receipts"));

export function setTaskLinkReceipt(key: string, receipt: SavedTaskLinkReceipt | null) {
  const { [key]: _previous, ...rest } = appAtomRegistry.get(taskLinkReceiptsAtom);
  appAtomRegistry.set(taskLinkReceiptsAtom, receipt ? { ...rest, [key]: receipt } : rest);
}

export const isTaskImageFile = (file: Pick<File, "type">) =>
  isProviderSendTurnSupportedImageMimeType(file.type);

/**
 * Dropped or pasted files as task attachment inputs: images inline as data URLs, other files
 * through the machine's upload store. Release the returned uploads once the task saved its copy.
 */
export async function taskAttachmentInputsFromFiles(
  environmentId: EnvironmentId,
  files: ReadonlyArray<File>,
): Promise<{ inputs: TaskAttachmentInput[]; release: () => void }> {
  const uploads: string[] = [];
  const release = () => uploads.forEach(releaseAttachmentUpload);
  const inputs = await Promise.all(
    files.map(async (file): Promise<TaskAttachmentInput> => {
      if (isTaskImageFile(file)) {
        return {
          kind: "upload",
          attachment: {
            type: "image",
            name: file.name || "image.png",
            mimeType: file.type,
            sizeBytes: file.size,
            dataUrl: await readFileAsDataUrl(file),
          },
        };
      }
      const staged: ComposerFileAttachment = {
        type: "file",
        id: randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        file,
      };
      uploads.push(staged.id);
      startAttachmentUpload({ environmentId, image: staged });
      await awaitAttachmentUploads([staged.id]);
      const uploaded = getUploadedAttachments({ environmentId, images: [staged] })?.[0];
      if (!uploaded) {
        const upload = readAttachmentUpload(staged.id);
        throw new Error(
          upload?.status === "failed"
            ? `${file.name}: ${upload.reason}`
            : `${file.name} failed to upload.`,
        );
      }
      return { kind: "upload", attachment: uploaded };
    }),
  ).catch((error: unknown) => {
    release();
    throw error;
  });
  return { inputs, release };
}

/** A task's stored copies as fresh composer attachments, so the composer sends them itself. */
export async function composerAttachmentsFromTask(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<ChatAttachment>,
): Promise<{ images: ComposerImageAttachment[]; files: ComposerFileAttachment[] }> {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error("The task's machine is not connected.");
  const images: ComposerImageAttachment[] = [];
  const files: ComposerFileAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.type !== "image" && attachment.type !== "file") continue;
    const result = await executeAtomQuery(
      appAtomRegistry,
      assetEnvironment.createUrl({
        environmentId,
        input: { resource: { _tag: "attachment", attachmentId: attachment.id } },
      }),
      { label: "tasks:attachment-url", reportFailure: false, reportDefect: false },
    );
    if (result._tag !== "Success") throw new Error(`Could not open ${attachment.name}.`);
    const url = resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl);
    const response = url ? await fetch(url) : null;
    if (!response?.ok) throw new Error(`Could not open ${attachment.name}.`);
    const file = new File([await response.blob()], attachment.name, { type: attachment.mimeType });
    const base = {
      id: randomUUID(),
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: file.size,
      file,
    };
    if (attachment.type === "image") {
      images.push({ ...base, type: "image", previewUrl: URL.createObjectURL(file) });
    } else {
      files.push({ ...base, type: "file" });
    }
  }
  return { images, files };
}
