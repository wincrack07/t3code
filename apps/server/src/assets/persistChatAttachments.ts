import {
  ChatAttachmentId,
  PersistChatAttachmentsError,
  type ThreadId,
  type MessageId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Base64 from "effect/encoding/Base64";
import * as ServerConfig from "../config.ts";
import {
  attachmentRelativePath,
  chatAttachmentStableKey,
  createDeterministicAttachmentId,
  createTaskAttachmentId,
} from "../attachmentStore.ts";
import { parseBase64DataUrl } from "../imageMime.ts";

export const persistChatAttachments = Effect.fn("ws.assets.persistChatAttachments")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly taskOwner?: string;
    readonly messageId: MessageId;
    readonly attachments: ReadonlyArray<{
      readonly type: "image";
      readonly name: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly dataUrl: string;
    }>;
  }) {
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.forEach(
      input.attachments.map((attachment, index) => ({ attachment, index })),
      Effect.fn("ws.assets.persistChatAttachment")(function* ({ attachment, index }) {
        const parsed = parseBase64DataUrl(attachment.dataUrl);
        if (parsed === null || parsed.mimeType !== attachment.mimeType.toLowerCase()) {
          return yield* new PersistChatAttachmentsError({
            message: `Attachment ${attachment.name} has an invalid image payload.`,
          });
        }
        const bytes = yield* Effect.fromResult(Base64.decode(parsed.base64)).pipe(
          Effect.mapError(
            (cause) =>
              new PersistChatAttachmentsError({
                message: `Attachment ${attachment.name} is not valid base64.`,
                cause,
              }),
          ),
        );
        if (bytes.byteLength !== attachment.sizeBytes) {
          return yield* new PersistChatAttachmentsError({
            message: `Attachment ${attachment.name} size does not match its payload.`,
          });
        }
        const key = chatAttachmentStableKey(input.messageId, index, bytes);
        const rawId =
          input.taskOwner === undefined
            ? createDeterministicAttachmentId(input.threadId, key)
            : createTaskAttachmentId(input.taskOwner, key);
        if (rawId === null) {
          return yield* new PersistChatAttachmentsError({
            message: "Could not allocate an attachment identifier.",
          });
        }
        const persisted = {
          type: "image" as const,
          id: ChatAttachmentId.make(rawId),
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        };
        yield* fileSystem
          .writeFile(path.join(config.attachmentsDir, attachmentRelativePath(persisted)!), bytes)
          .pipe(
            Effect.mapError(
              (cause) =>
                new PersistChatAttachmentsError({
                  message: `Could not persist attachment ${attachment.name}.`,
                  cause,
                }),
            ),
          );
        return persisted;
      }),
      { concurrency: 2 },
    );
  },
);
