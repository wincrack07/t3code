import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { projectEnvironment } from "../../state/projects";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type DesktopFinderItem,
} from "@t3tools/contracts";
import { finderProjectForPaths } from "@t3tools/shared/finderIntegration";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { useRouter } from "@tanstack/react-router";
import { useEffectEvent } from "react";
import { openCommandPalette } from "../../commandPaletteBus";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import { useComposerDraftStore } from "../../composerDraftStore";
import { requestConfirmDialog } from "../../confirmDialog";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { readProjects, readThreadShell } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { randomUUID } from "../../lib/utils";
import { prepareImageForAttachment } from "../../lib/imageCompression";
import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import {
  classifyComposerAttachmentFile,
  normalizeComposerImageFileMimeType,
  composerFileAttachmentMimeType,
} from "../chat/composerAttachmentFiles";
import { toastManager } from "../ui/toast";

function waitForPaletteClose() {
  return new Promise<void>((resolve) => {
    if (!useCommandPaletteStore.getState().open) {
      resolve();
      return;
    }
    const unsubscribe = useCommandPaletteStore.subscribe((state) => {
      if (!state.open) {
        unsubscribe();
        resolve();
      }
    });
  });
}

export function useFinderSelection() {
  const router = useRouter();
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const openThread = useNewThreadHandler();
  const updateProject = useOrchestrationCommand(projectEnvironment.update, {
    label: "project unarchive",
  });
  const { openScratchProject } = useScratchProject();
  return useEffectEvent(async (url: string) => {
    const bridge = window.desktopBridge?.finderIntegration;
    if (!bridge) return;
    const prepare = async () => {
      const items = await bridge.inspect(url);
      const route = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
      const active =
        route?.kind === "draft"
          ? useComposerDraftStore.getState().getDraftSession(route.draftId)
          : route?.kind === "server"
            ? readThreadShell(route.threadRef)
            : null;
      const environmentId = active?.environmentId ?? primaryId;
      if (!environmentId)
        throw new Error("Connect an environment before sending files from Finder.");
      const local = environmentId === primaryId;
      if (
        !local &&
        items.some((item) => item.kind === "file") &&
        !(await requestConfirmDialog(
          `Upload the selected Finder files to ${environments.find((entry) => entry.environmentId === environmentId)?.label ?? "this remote environment"} to prepare a draft?`,
        ))
      )
        return;
      const projects = readProjects();
      const openProjectDraft = async (project: (typeof projects)[number]) => {
        if (project.archivedAt != null) {
          const result = await updateProject({
            environmentId: project.environmentId,
            input: { projectId: project.id, archived: false },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        }
        return openThread(scopeProjectRef(project.environmentId, project.id));
      };
      const groups = new Map<
        string,
        { project: (typeof projects)[number] | null; items: DesktopFinderItem[] }
      >();
      for (const item of items.filter((item) => item.kind === "file")) {
        const project = local
          ? finderProjectForPaths(
              [item.path],
              projects.filter((project) => project.environmentId === environmentId),
            )
          : (projects.find(
              (project) =>
                project.environmentId === environmentId && project.id === active?.projectId,
            ) ?? null);
        const key = project?.id ?? "scratch";
        const group = groups.get(key) ?? { project, items: [] };
        group.items.push(item);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const project = group.project ?? (await openScratchProject(environmentId));
        if (!project) continue;
        const byReference = local && group.project !== null;
        const opened = await openProjectDraft(project);
        if (!opened) continue;
        if (byReference) {
          const store = useComposerDraftStore.getState();
          const existing = store.getComposerDraft(opened.draftId)?.prompt ?? "";
          store.setPrompt(
            opened.draftId,
            `${existing}${existing ? " " : ""}${group.items.map((item) => serializeComposerFileLink(item.path)).join(" ")} `,
          );
          continue;
        }
        const advertised = environments.find((entry) => entry.environmentId === environmentId)
          ?.serverConfig?.environment.capabilities.fileAttachments?.maxUploadBytes;
        const uploadLimit =
          advertised === undefined ? null : clampFileAttachmentUploadBytes(advertised);
        if (uploadLimit === null)
          throw new Error("This environment does not support file attachments.");
        for (const item of group.items) {
          if (
            item.sizeBytes <= 0 ||
            item.sizeBytes > Math.min(PROVIDER_SEND_TURN_MAX_FILE_BYTES, uploadLimit)
          )
            throw new Error(`${item.name} is empty or exceeds this environment’s upload limit.`);
          const data = await bridge.read(item.id);
          if (data.byteLength > uploadLimit)
            throw new Error(`${item.name} exceeds this environment’s upload limit.`);
          const raw = new File([new Uint8Array(data)], item.name);
          const kind = classifyComposerAttachmentFile(raw);
          if (kind === "unsupported-image")
            throw new Error(`${item.name} is not a supported image type.`);
          if (kind === "image") {
            const result = await prepareImageForAttachment(
              normalizeComposerImageFileMimeType(raw),
              PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
            );
            if (!result.ok) throw new Error(`${item.name} could not be prepared as an image.`);
            const file = result.file;
            const previewUrl = URL.createObjectURL(file);
            const accepted = useComposerDraftStore.getState().addImages(opened.draftId, [
              {
                type: "image",
                id: randomUUID(),
                name: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
                previewUrl,
                file,
              },
            ]);
            if (!accepted.length) {
              URL.revokeObjectURL(previewUrl);
              throw new Error("The draft cannot accept another attachment.");
            }
            continue;
          }
          const mimeType = composerFileAttachmentMimeType(raw);
          const file = new File([raw], item.name, { type: mimeType });
          const accepted = useComposerDraftStore.getState().addFiles(opened.draftId, [
            {
              type: "file",
              id: randomUUID(),
              name: item.name,
              mimeType,
              sizeBytes: file.size,
              file,
            },
          ]);
          if (!accepted.length) throw new Error("The draft cannot accept another attachment.");
        }
      }
      for (const folder of items.filter((item) => item.kind === "folder")) {
        if (!primaryId)
          throw new Error("Enable the local environment to open a Finder folder as a project.");
        if (!(await requestConfirmDialog(`Open ${folder.path} as a local project?`))) continue;
        const project = projects.find(
          (project) =>
            project.environmentId === primaryId &&
            project.workspaceRoot.replace(/\/+$/, "") === folder.path.replace(/\/+$/, ""),
        );
        if (project) await openProjectDraft(project);
        else {
          openCommandPalette({
            open: "add-project",
            folder: { path: folder.path, environmentId: primaryId },
          });
          await waitForPaletteClose();
        }
      }
    };
    return prepare().catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not receive Finder selection",
        description: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
