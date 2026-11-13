import { T3ThreadExport as T3ThreadExportSchema } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { EnvironmentId, ScopedThreadRef, T3ThreadExport } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { renderThreadExportMarkdown, threadExportPath } from "@t3tools/shared/threadExport";
import { appAtomRegistry } from "../rpc/atomRegistry";

async function loadChatExport(ref: ScopedThreadRef) {
  const { orchestrationEnvironment } = await import("../state/orchestration");
  const result = await runAtomCommand(
    appAtomRegistry,
    orchestrationEnvironment.threadExport,
    { environmentId: ref.environmentId, input: { threadId: ref.threadId } },
    { reportFailure: false },
  );
  if (!AsyncResult.isSuccess(result))
    throw new Error(
      "Could not export this chat. Check that its environment is connected and up to date.",
    );
  return result.value.bundle;
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadChat(ref: ScopedThreadRef, format: "md" | "json") {
  const bundle = await loadChatExport(ref);
  const basename = threadExportPath(bundle).split("/").at(-1) ?? "chat";
  downloadFile(
    new Blob([format === "md" ? renderThreadExportMarkdown(bundle) : JSON.stringify(bundle)], {
      type: format === "md" ? "text/markdown" : "application/json",
    }),
    `${basename}.${format === "md" ? "md" : "t3thread.json"}`,
  );
}

export async function downloadAllChats(
  environmentIds: ReadonlyArray<EnvironmentId>,
  progress: (count: number) => void,
) {
  const { orchestrationEnvironment } = await import("../state/orchestration");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folders = new Map<string, Array<{ bundle: T3ThreadExport; filename: string }>>();
  let count = 0;
  for (const environmentId of environmentIds) {
    const result = await runAtomCommand(
      appAtomRegistry,
      orchestrationEnvironment.threadExportIndex,
      { environmentId, input: {} },
      { reportFailure: false },
    );
    if (!AsyncResult.isSuccess(result))
      throw new Error(
        "Could not list chats in a connected environment. Update that server and try again.",
      );
    for (const threadId of result.value) {
      const bundle = await loadChatExport({ environmentId, threadId });
      const path = threadExportPath(bundle);
      zip.file(`${path}.md`, renderThreadExportMarkdown(bundle));
      zip.file(`${path}.t3thread.json`, JSON.stringify(bundle));
      const folder = path.slice(0, path.lastIndexOf("/"));
      const rows = folders.get(folder) ?? [];
      rows.push({ bundle, filename: path.slice(path.lastIndexOf("/") + 1) });
      folders.set(folder, rows);
      progress(++count);
    }
  }
  for (const [folder, rows] of folders) {
    rows.sort((a, b) => b.bundle.updatedAt.localeCompare(a.bundle.updatedAt));
    zip.file(
      `${folder}/_index.md`,
      rows
        .map(
          ({ bundle, filename }) => `- [[${filename}|${bundle.title.replace(/[\][|\r\n]/g, " ")}]]`,
        )
        .join("\n") + "\n",
    );
  }
  downloadFile(
    await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    "t3code-chats.zip",
  );
  return count;
}

const decodeBundle = Schema.decodeUnknownSync(T3ThreadExportSchema);

export async function readChatImports(files: FileList): Promise<T3ThreadExport[]> {
  const bundles: T3ThreadExport[] = [];
  let bytes = 0;
  for (const file of Array.from(files)) {
    if (file.size > 100_000_000) throw new Error("Import files must be smaller than 100 MB.");
    if (file.name.toLowerCase().endsWith(".zip")) {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || !entry.name.endsWith(".t3thread.json")) continue;
        const raw = await entry.async("string");
        const size = new TextEncoder().encode(raw).length;
        bytes += size;
        if (bytes > 100_000_000 || size > 10_000_000)
          throw new Error("Import exceeds the 100 MB batch or 10 MB thread limit.");
        bundles.push(decodeBundle(JSON.parse(raw)));
      }
    } else {
      bytes += file.size;
      if (bytes > 100_000_000) throw new Error("Import exceeds the 100 MB batch limit.");
      if (file.size > 10_000_000) throw new Error("Thread bundles must be smaller than 10 MB.");
      bundles.push(decodeBundle(JSON.parse(await file.text())));
    }
  }
  if (!bundles.length) throw new Error("No .t3thread.json files found.");
  return bundles;
}
