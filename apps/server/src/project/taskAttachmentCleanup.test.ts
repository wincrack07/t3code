import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ChatAttachmentId,
  DEFAULT_MACHINE_CLEANUP_SETTINGS,
  type ProjectSavedPrompt,
  type MachineCleanupReport,
  type ProjectTaskAttachment,
} from "@t3tools/contracts";
import { createTaskAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { selectedMachineCleanupItems } from "../machineCleanupSchedule.ts";
import { taskAttachmentOwner } from "./taskAttachmentFiles.ts";
import { scanTaskAttachmentCopies, deleteTaskAttachmentCopy } from "./taskAttachmentCleanup.ts";

it.effect(
  "counts task copies and requires current explicit approval while retaining references and changed owners",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "task-cleanup-home-" });
      const storage = {
        baseDir: home,
        stateDir: path.join(home, "userdata"),
        attachmentsDir: path.join(home, "userdata", "attachments"),
      };
      yield* fs.makeDirectory(storage.attachmentsDir, { recursive: true });
      const copies: ProjectTaskAttachment[] = [];
      for (const [index, id] of ["open", "done", "orphan"].entries()) {
        const copy = {
          kind: "stored" as const,
          attachment: {
            type: "file" as const,
            id: ChatAttachmentId.make(
              createTaskAttachmentId(taskAttachmentOwner("project", id), "upload", ".bin")!,
            ),
            name: `${id}.bin`,
            mimeType: "application/octet-stream",
            sizeBytes: index + 1,
          },
        };
        yield* fs.writeFileString(
          resolveAttachmentPath({
            attachmentsDir: storage.attachmentsDir,
            attachment: copy.attachment,
          })!,
          "x".repeat(index + 1),
        );
        copies.push(copy);
      }
      const task = (
        id: string,
        attachment: ProjectTaskAttachment,
        done: boolean,
      ): ProjectSavedPrompt => ({
        id,
        text: id,
        createdAt: "2026-01-01T00:00:00Z",
        completedAt: done ? "2026-01-02T00:00:00Z" : null,
        status: done ? "done" : "open",
        attachments: [attachment],
      });
      const tasks = [task("open", copies[0]!, false), task("done", copies[1]!, true)];
      const rows = [{ title: "Demo", deletedAt: null, savedPrompts: tasks }];
      const scanned = yield* Effect.promise(() =>
        scanTaskAttachmentCopies(storage, rows, DEFAULT_MACHINE_CLEANUP_SETTINGS),
      );
      expect(scanned.usage).toEqual({
        open: { count: 1, bytes: 1 },
        done: { count: 1, bytes: 2 },
        orphaned: { count: 1, bytes: 3 },
      });
      const report: MachineCleanupReport = {
        id: "scan",
        mode: "scan",
        platform: "linux",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: null,
        freeBefore: 0,
        freeAfter: 0,
        measurementPath: home,
        notes: [],
        items: scanned.items,
      };
      expect(selectedMachineCleanupItems(report, "phaseA", []).length).toBe(0);
      expect(selectedMachineCleanupItems(report, "phaseB", []).length).toBe(0);
      const all = scanned.items.map((item) => item.id);
      expect(
        selectedMachineCleanupItems(report, "phaseB", all)
          .map((item) => item.rule)
          .sort(),
      ).toEqual(["task-attachments-done", "task-attachments-orphaned"]);
      const done = scanned.items.find((item) => item.rule === "task-attachments-done")!;
      const reopened = [
        {
          ...rows[0]!,
          savedPrompts: tasks.map((task) => ({
            ...task,
            status: "open" as const,
            completedAt: null,
          })),
        },
      ];
      expect(
        (yield* Effect.promise(() =>
          deleteTaskAttachmentCopy(storage, reopened, DEFAULT_MACHINE_CLEANUP_SETTINGS, done),
        )).outcome,
      ).toBe("skipped");
      expect(yield* fs.exists(done.path)).toBe(true);
      const orphan = scanned.items.find((item) => item.rule === "task-attachments-orphaned")!;
      const outside = path.join(home, "reference.txt");
      yield* fs.writeFileString(outside, "Keep this reference");
      expect(
        (yield* Effect.promise(() =>
          deleteTaskAttachmentCopy(storage, rows, DEFAULT_MACHINE_CLEANUP_SETTINGS, {
            ...orphan,
            path: outside,
          }),
        )).outcome,
      ).toBe("skipped");
      expect(yield* fs.readFileString(outside)).toBe("Keep this reference");
      expect(
        (yield* Effect.promise(() =>
          deleteTaskAttachmentCopy(storage, rows, DEFAULT_MACHINE_CLEANUP_SETTINGS, orphan),
        )).outcome,
      ).toBe("removed");
      expect(yield* fs.exists(orphan.path)).toBe(false);
      const protectedScan = yield* Effect.promise(() =>
        scanTaskAttachmentCopies(storage, rows, {
          ...DEFAULT_MACHINE_CLEANUP_SETTINGS,
          protectedPaths: [storage.attachmentsDir],
        }),
      );
      expect(protectedScan.items.every((item) => item.outcome === "protected")).toBe(true);
      const open = scanned.items.find((item) => item.rule === "task-attachments-open")!;
      expect(selectedMachineCleanupItems(report, "phaseC", [open.id])).toHaveLength(1);
      expect(
        (yield* Effect.promise(() =>
          deleteTaskAttachmentCopy(storage, rows, DEFAULT_MACHINE_CLEANUP_SETTINGS, open),
        )).outcome,
      ).toBe("removed");
      expect(yield* fs.exists(outside)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
