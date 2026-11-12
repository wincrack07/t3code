import { machineRuleEnabled } from "../machineCleanupRules.ts";
// @effect-diagnostics nodeBuiltinImport:off -- cleanup checks regular files and inode identity immediately before unlinking.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type {
  MachineCleanupItem,
  MachineCleanupSettings,
  TaskAttachmentUsage,
} from "@t3tools/contracts";
import type { ProjectRow } from "../orchestration-v2/ProjectStore.ts";
import { isTaskAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import type { TaskAttachmentStorage } from "./taskAttachmentFiles.ts";

type Group = "open" | "done" | "orphaned";
const within = (target: string, root: string) =>
  target === root || target.startsWith(`${root}${NodePath.sep}`);
const headOf = (
  info: Awaited<ReturnType<typeof NodeFSP.lstat>>,
  sidecar: Awaited<ReturnType<typeof NodeFSP.lstat>> | null,
) =>
  JSON.stringify([
    info.dev,
    info.ino,
    info.size,
    info.mtimeMs,
    sidecar?.ino,
    sidecar?.size,
    sidecar?.mtimeMs,
  ]);
export async function scanTaskAttachmentCopies(
  storage: TaskAttachmentStorage,
  projects: ReadonlyArray<Pick<ProjectRow, "savedPrompts" | "title" | "deletedAt" | "taskBatches">>,
  settings: MachineCleanupSettings,
  onlyPath?: string,
): Promise<{ items: MachineCleanupItem[]; usage: TaskAttachmentUsage }> {
  const owners = new Map<string, { group: Group; project: string }>();
  for (const project of projects) {
    if (project.deletedAt !== null) continue;
    const queued = (project.taskBatches ?? [])
      .flatMap((batch) => batch.entries)
      .flatMap((entry) =>
        (entry.state === "queued" || entry.state === "starting") && entry.brief !== undefined
          ? [{ ...entry.brief, status: "in-progress" as const, completedAt: null }]
          : [],
      );
    for (const task of [...(project.savedPrompts ?? []), ...queued]) {
      if (task.deletedAt !== undefined) continue;
      for (const item of task.attachments ?? []) {
        if (item.kind !== "stored") continue;
        const target = resolveAttachmentPath({
          attachmentsDir: storage.attachmentsDir,
          attachment: item.attachment,
        });
        if (target && owners.get(target)?.group !== "open")
          owners.set(target, {
            group: (task.status === undefined ? task.completedAt !== null : task.status === "done")
              ? "done"
              : "open",
            project: project.title,
          });
      }
    }
  }
  const usage = {
    open: { count: 0, bytes: 0 },
    done: { count: 0, bytes: 0 },
    orphaned: { count: 0, bytes: 0 },
  };
  const items: MachineCleanupItem[] = [];
  const protectedPaths = await Promise.all(
    settings.protectedPaths.map(async (root) => {
      const lexical = NodePath.resolve(root);
      return [lexical, await NodeFSP.realpath(lexical).catch(() => lexical)];
    }),
  );
  const canonicalRoot = await NodeFSP.realpath(storage.attachmentsDir).catch(
    () => storage.attachmentsDir,
  );

  const entries =
    onlyPath === undefined
      ? await NodeFSP.readdir(storage.attachmentsDir).catch(() => [])
      : NodePath.dirname(onlyPath) === NodePath.resolve(storage.attachmentsDir)
        ? [NodePath.basename(onlyPath)]
        : [];
  for (const name of entries) {
    const id = name.slice(0, name.lastIndexOf("."));
    if (!isTaskAttachmentId(id)) continue;
    const target = NodePath.join(storage.attachmentsDir, name);
    const info = await NodeFSP.lstat(target).catch(() => null);
    if (!info?.isFile() || info.nlink !== 1) continue;
    const sidecar = await NodeFSP.lstat(`${target}.txt`).catch(() => null);
    const bytes = info.size + (sidecar?.isFile() && sidecar.nlink === 1 ? sidecar.size : 0);
    const owner = owners.get(target) ?? { group: "orphaned" as const, project: "" };
    usage[owner.group].count++;
    usage[owner.group].bytes += bytes;
    const rule = `task-attachments-${owner.group}`;
    const protectedPath = protectedPaths.some(
      ([lexical, canonical]) =>
        within(target, lexical!) || within(NodePath.join(canonicalRoot, name), canonical!),
    );
    const enabled = machineRuleEnabled(settings, rule);
    items.push({
      id: `task-attachment:${name}`,
      path: target,
      rule,
      phase: owner.group === "open" ? "C" : "B",
      bytes,
      probablyActive: owner.group === "open",
      outcome: protectedPath || !enabled ? "protected" : "pending",
      reason: protectedPath
        ? "Protected path"
        : !enabled
          ? "Rule disabled"
          : owner.group === "open"
            ? "Open-task copy; individual explicit approval required"
            : "Stored task attachment copy",
      effect: "Remove this stored copy; task metadata remains and shows it as missing",
      project: owner.project,
      branch: null,
      changes: 0,
      head: headOf(info, sidecar),
    });
  }
  return { items, usage };
}
export async function deleteTaskAttachmentCopy(
  storage: TaskAttachmentStorage,
  projects: ReadonlyArray<Pick<ProjectRow, "savedPrompts" | "title" | "deletedAt" | "taskBatches">>,
  settings: MachineCleanupSettings,
  approved: MachineCleanupItem,
): Promise<MachineCleanupItem> {
  const fresh = (
    await scanTaskAttachmentCopies(storage, projects, settings, approved.path)
  ).items.find((item) => item.id === approved.id);
  if (
    !fresh ||
    fresh.outcome !== "pending" ||
    fresh.phase !== approved.phase ||
    fresh.head !== approved.head ||
    fresh.path !== approved.path
  )
    return {
      ...approved,
      outcome: "skipped",
      reason: "Attachment or task ownership changed since approval",
    };
  const root = await NodeFSP.realpath(storage.attachmentsDir);
  const canonical = await NodeFSP.realpath(fresh.path);
  if (
    NodePath.dirname(canonical) !== root ||
    (await NodeFSP.lstat(fresh.path)).isSymbolicLink() ||
    settings.protectedPaths.some((target) => within(canonical, NodePath.resolve(target)))
  )
    return { ...approved, outcome: "protected", reason: "Unsafe attachment path" };
  // The generic cleaner protects all T3 state; this exception admits only scanned task-owned regular files.
  const sidecar = `${fresh.path}.txt`;
  const sidecarInfo = await NodeFSP.lstat(sidecar).catch(() => null);
  if (sidecarInfo && (!sidecarInfo.isFile() || sidecarInfo.nlink !== 1))
    return { ...approved, outcome: "protected", reason: "Unsafe attachment sidecar" };
  if (sidecarInfo) await NodeFSP.unlink(sidecar);
  await NodeFSP.unlink(fresh.path);
  return { ...approved, outcome: "removed", reason: "Approved stored task copy removed" };
}
