// @effect-diagnostics nodeBuiltinImport:off -- attachment copies and cleanup require exclusive filesystem operations.
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import {
  ChatAttachment,
  ChatAttachmentId,
  TaskAttachmentError,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  isProviderSendTurnSupportedImageMimeType,
  type ProjectTaskAttachment,
  type TaskAttachmentInput,
  type TaskAttachmentMetadata,
  taskAttachmentKey,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Mime from "effect/http/Mime";
import {
  attachmentFileExtension,
  createTaskAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import { inferImageExtension } from "../imageMime.ts";

export interface TaskAttachmentStorage {
  readonly attachmentsDir: string;
  readonly baseDir: string;
  readonly stateDir: string;
}
const decodeAttachment = Schema.decodeUnknownSync(ChatAttachment);
const within = (target: string, root: string) =>
  target === root || target.startsWith(`${root}${NodePath.sep}`);
function isTemporaryTaskPath(target: string, storage: TaskAttachmentStorage): boolean {
  return [
    NodeOS.tmpdir(),
    "/tmp",
    "/private/tmp",
    "/var/folders",
    storage.attachmentsDir,
    NodePath.join(storage.baseDir, "scratch"),
    NodePath.join(storage.baseDir, "tmp"),
    NodePath.join(storage.stateDir, "tmp"),
  ].some((root) => within(NodePath.resolve(target), NodePath.resolve(root)));
}
export function taskAttachmentOwner(projectId: string, taskId: string): string {
  return `saved-task-${NodeCrypto.createHash("sha256")
    .update(JSON.stringify([projectId, taskId]))
    .digest("hex")
    .slice(0, 32)}`;
}
export async function prepareTaskAttachment(input: {
  readonly storage: TaskAttachmentStorage;
  readonly projectId: string;
  readonly taskId: string;
  readonly commandId: string;
  readonly index: number;
  readonly attachment: TaskAttachmentInput;
}): Promise<ProjectTaskAttachment> {
  const { storage, attachment } = input;
  let source: string;
  let metadata: ChatAttachment;
  if (attachment.kind === "path") {
    if (!NodePath.isAbsolute(attachment.path))
      throw new TaskAttachmentError({
        reason: "invalid-path",
        message: "Use an absolute file or folder path.",
      });
    source = NodePath.resolve(attachment.path);
    const canonical = await NodeFSP.realpath(source).catch(() => {
      throw new TaskAttachmentError({
        reason: "source-missing",
        message: `The source is missing: ${source}`,
      });
    });
    const info = await NodeFSP.stat(canonical);
    if (!info.isDirectory() && !info.isFile())
      throw new TaskAttachmentError({
        reason: "invalid-path",
        message: "Only files and folders can be attached.",
      });
    const temporary =
      isTemporaryTaskPath(source, storage) || isTemporaryTaskPath(canonical, storage);
    if (!temporary || info.isDirectory())
      return {
        kind: "reference",
        path: source,
        temporary,
        sizeBytes: info.isFile() ? info.size : 0,
        isDirectory: info.isDirectory(),
      };
    const mimeType = Option.getOrElse(Mime.getType(source), () => "application/octet-stream");
    const cap = isProviderSendTurnSupportedImageMimeType(mimeType)
      ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
      : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
    if (info.size > cap)
      throw new TaskAttachmentError({
        reason: "limit",
        message: `The attachment exceeds the ${cap / 1024 / 1024} MiB limit.`,
      });
    metadata = decodeAttachment({
      type: isProviderSendTurnSupportedImageMimeType(mimeType) ? "image" : "file",
      id: "placeholder",
      name: NodePath.basename(source),
      mimeType,
      sizeBytes: info.size,
    });
    source = canonical;
  } else {
    metadata = decodeAttachment(attachment.attachment);
    const resolved = resolveAttachmentPath({
      attachmentsDir: storage.attachmentsDir,
      attachment: metadata,
    });
    if (!resolved || (metadata.type !== "image" && metadata.type !== "file"))
      throw new TaskAttachmentError({
        reason: "invalid-path",
        message: "This attachment type cannot be stored.",
      });
    source = resolved;
    const canonical = await NodeFSP.realpath(source).catch(() => {
      throw new TaskAttachmentError({
        reason: "source-missing",
        message: `Upload '${metadata.name}' is missing or expired. Upload it again.`,
      });
    });
    if (!within(canonical, await NodeFSP.realpath(storage.attachmentsDir)))
      throw new TaskAttachmentError({
        reason: "invalid-path",
        message: "The upload is outside attachment storage.",
      });
  }
  const extension =
    metadata.type === "image"
      ? inferImageExtension({ mimeType: metadata.mimeType, fileName: metadata.name })
      : attachmentFileExtension(metadata.name);
  const id = createTaskAttachmentId(
    taskAttachmentOwner(input.projectId, input.taskId),
    `${input.commandId}:${input.index}`,
    extension,
  );
  if (!id)
    throw new TaskAttachmentError({
      reason: "invalid-path",
      message: "Could not allocate attachment storage.",
    });
  const stored = { ...metadata, id: ChatAttachmentId.make(id) };
  const destination = resolveAttachmentPath({
    attachmentsDir: storage.attachmentsDir,
    attachment: stored,
  });
  if (!destination)
    throw new TaskAttachmentError({
      reason: "invalid-path",
      message: "Could not resolve attachment storage.",
    });
  await NodeFSP.mkdir(storage.attachmentsDir, { recursive: true });
  const sourceInfo = await NodeFSP.stat(source).catch(() => {
    throw new TaskAttachmentError({
      reason: "source-missing",
      message: `The source is missing: ${source}`,
    });
  });
  if (!sourceInfo.isFile() || sourceInfo.size !== metadata.sizeBytes)
    throw new TaskAttachmentError({
      reason: "invalid-size",
      message: "The attachment changed size. Attach it again.",
    });
  const partial = `${destination}.${NodeCrypto.randomUUID()}.part`;
  try {
    await NodeFSP.copyFile(source, partial);
    if ((await NodeFSP.stat(partial)).size !== metadata.sizeBytes)
      throw new TaskAttachmentError({
        reason: "invalid-size",
        message: "The source changed while being copied.",
      });
    await NodeFSP.link(partial, destination).catch(async (error: NodeJS.ErrnoException) => {
      if (
        error.code !== "EEXIST" ||
        (await NodeFSP.lstat(destination)).size !== metadata.sizeBytes ||
        !(await NodeFSP.lstat(destination)).isFile()
      )
        throw error;
    });
  } finally {
    await NodeFSP.rm(partial, { force: true });
  }
  return { kind: "stored", attachment: stored };
}
export async function taskAttachmentMetadata(
  storage: TaskAttachmentStorage,
  item: ProjectTaskAttachment,
): Promise<TaskAttachmentMetadata> {
  const target =
    item.kind === "reference"
      ? item.path
      : resolveAttachmentPath({
          attachmentsDir: storage.attachmentsDir,
          attachment: item.attachment,
        });
  const info = target ? await NodeFSP.stat(target).catch(() => null) : null;
  return {
    warning:
      item.kind === "reference" && item.temporary && (item.isDirectory || info?.isDirectory())
        ? "Temporary folders remain references and may disappear."
        : null,
    key: taskAttachmentKey(item),
    attachment: item,
    missing: info === null,
    sizeBytes: info?.isFile() ? info.size : 0,
    isDirectory: info?.isDirectory() ?? false,
  };
}
