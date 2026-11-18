import type { EnvironmentId, T3ThreadExport } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";
import { msg } from "gt-react";
import {
  importBackupFingerprint,
  importProjectKey,
  portableImportThreadId,
} from "@t3tools/shared/threadExport";
import { m, type MessageResolver } from "../../i18n/messages";

export const NEW_PROJECT = "new";
export const IMPORT_STEPS = [
  msg("Chats", { $context: "import wizard step" }),
  msg("Folders", { $context: "import wizard step" }),
  msg("Import", { $context: "import wizard step" }),
] as const;
const DRAFT_KEY = "t3code:chat-import-draft";

export interface ImportChatRef {
  readonly id: string;
  readonly projectKey: string;
  readonly title: string;
  readonly projectTitle: string;
  readonly sourcePath: string;
}

export interface ImportDraft {
  readonly step: number;
  readonly baseDirectory: string;
  readonly moveExisting: boolean;
  readonly destinations: Readonly<Record<string, string>>;
  readonly skippedProjects: ReadonlySet<string>;
  readonly skippedChats: ReadonlySet<string>;
  readonly doneChats: ReadonlySet<string>;
}

export interface ImportSession {
  readonly fingerprint: string;
  readonly fileLabel: string;
  readonly bundles: readonly T3ThreadExport[];
  readonly environmentId: EnvironmentId;
  readonly draft: ImportDraft;
  readonly open: boolean;
  readonly status: string;
  readonly busy: boolean;
}

interface StoredImportDraft {
  readonly fingerprint: string;
  readonly fileLabel: string;
  readonly step: number;
  readonly baseDirectory: string;
  readonly moveExisting: boolean;
  readonly destinations: Readonly<Record<string, string>>;
  readonly skippedProjects: readonly string[];
  readonly skippedChats: readonly string[];
  readonly doneChats: readonly string[];
}

export function importChats(bundles: readonly T3ThreadExport[]): ImportChatRef[] {
  return bundles.map((bundle) => ({
    id: portableImportThreadId(bundle),
    projectKey: importProjectKey(bundle.project),
    title: bundle.title,
    projectTitle: bundle.project.title,
    sourcePath: bundle.project.repository?.canonicalKey ?? bundle.project.workspacePath,
  }));
}

export function emptyDraft(
  destinations: Readonly<Record<string, string>>,
  baseDirectory: string,
): ImportDraft {
  return {
    step: 0,
    baseDirectory,
    moveExisting: false,
    destinations,
    skippedProjects: new Set(),
    skippedChats: new Set(),
    doneChats: new Set(),
  };
}

export function chatIncluded(draft: ImportDraft, projectKey: string, chatId: string): boolean {
  return !draft.skippedProjects.has(projectKey) && !draft.skippedChats.has(chatId);
}

export function projectSelection(
  draft: ImportDraft,
  projectKey: string,
  chatIds: readonly string[],
): "all" | "some" | "none" | "done" {
  const open = chatIds.filter((id) => !draft.doneChats.has(id));
  if (open.length === 0) return "done";
  const selected = open.filter((id) => chatIncluded(draft, projectKey, id)).length;
  if (selected === 0) return "none";
  if (selected === open.length) return "all";
  return "some";
}

export function toggleProject(
  draft: ImportDraft,
  projectKey: string,
  chatIds: readonly string[],
): ImportDraft {
  const skippedProjects = new Set(draft.skippedProjects);
  const skippedChats = new Set(draft.skippedChats);
  if (projectSelection(draft, projectKey, chatIds) === "all") skippedProjects.add(projectKey);
  else {
    skippedProjects.delete(projectKey);
    for (const id of chatIds) skippedChats.delete(id);
  }
  return { ...draft, skippedProjects, skippedChats };
}

export function toggleChat(
  draft: ImportDraft,
  projectKey: string,
  chatId: string,
  chatIds: readonly string[],
): ImportDraft {
  const skippedProjects = new Set(draft.skippedProjects);
  const skippedChats = new Set(draft.skippedChats);
  if (skippedProjects.has(projectKey)) {
    skippedProjects.delete(projectKey);
    for (const id of chatIds) {
      if (id !== chatId && !draft.doneChats.has(id)) skippedChats.add(id);
    }
    skippedChats.delete(chatId);
    return { ...draft, skippedProjects, skippedChats };
  }
  if (skippedChats.has(chatId)) skippedChats.delete(chatId);
  else skippedChats.add(chatId);
  const open = chatIds.filter((id) => !draft.doneChats.has(id));
  if (open.every((id) => skippedChats.has(id))) {
    skippedProjects.add(projectKey);
    for (const id of open) skippedChats.delete(id);
  }
  return { ...draft, skippedProjects, skippedChats };
}

export function setAllProjects(
  draft: ImportDraft,
  projectKeys: readonly string[],
  selected: boolean,
): ImportDraft {
  return {
    ...draft,
    skippedProjects: selected ? new Set() : new Set(projectKeys),
    skippedChats: new Set(),
  };
}

export function markChatsDone(draft: ImportDraft, ids: readonly string[]): ImportDraft {
  const doneChats = new Set(draft.doneChats);
  for (const id of ids) doneChats.add(id);
  return { ...draft, doneChats };
}

export function remainingChats<T extends { readonly id: string; readonly projectKey: string }>(
  chats: readonly T[],
  draft: ImportDraft,
): T[] {
  return chats.filter(
    (chat) => !draft.doneChats.has(chat.id) && chatIncluded(draft, chat.projectKey, chat.id),
  );
}

function isAbsoluteImportPath(value: string): boolean {
  const base = value.trim();
  return base.startsWith("/") || base.startsWith("~/") || isWindowsAbsolutePath(base);
}

export function foldersReady(
  draft: ImportDraft,
  groups: readonly { readonly key: string }[],
  chats: readonly { readonly id: string; readonly projectKey: string }[],
  knownProjectIds: ReadonlySet<string>,
): boolean {
  const keys = new Set(remainingChats(chats, draft).map((chat) => chat.projectKey));
  if (keys.size === 0) return false;
  let needsBase = false;
  for (const group of groups) {
    if (!keys.has(group.key)) continue;
    const destination = draft.destinations[group.key];
    if (destination === NEW_PROJECT) needsBase = true;
    else if (destination === undefined || !knownProjectIds.has(destination)) return false;
  }
  return !needsBase || isAbsoluteImportPath(draft.baseDirectory);
}

export function mergeDestinations(
  groups: readonly { readonly key: string; readonly project: { readonly id: string } | null }[],
  saved: Readonly<Record<string, string>> | undefined,
  knownProjectIds: ReadonlySet<string>,
): Record<string, string> {
  return Object.fromEntries(
    groups.map((group) => {
      const savedValue = saved?.[group.key];
      const valid =
        savedValue === NEW_PROJECT || (savedValue !== undefined && knownProjectIds.has(savedValue));
      return [group.key, valid ? savedValue : (group.project?.id ?? NEW_PROJECT)];
    }),
  );
}

export function projectQueryMatches(
  title: string,
  sourcePath: string,
  chatTitles: readonly string[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (title.toLowerCase().includes(needle) || sourcePath.toLowerCase().includes(needle))
    return true;
  return chatTitles.some((chatTitle) => chatTitle.toLowerCase().includes(needle));
}

export function importProgressLabel(
  counts: {
    readonly imported: number;
    readonly present: number;
    readonly moved: number;
  },
  resolve: MessageResolver = m,
): string {
  return [
    resolve(msg("Imported {count}", { count: counts.imported })),
    counts.present > 0 ? resolve(msg("{count} already present", { count: counts.present })) : null,
    counts.moved > 0
      ? resolve(msg("{count} moved to their project", { count: counts.moved }))
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export function importFileLabel(names: readonly string[]): string {
  const [only] = names;
  return names.length === 1 && only !== undefined ? only : `${names.length} files`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export function parseStoredDraft(value: unknown, fingerprint: string): ImportDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Partial<StoredImportDraft>;
  if (stored.fingerprint !== fingerprint || typeof stored.baseDirectory !== "string") return null;
  const destinations = stored.destinations;
  if (typeof destinations !== "object" || destinations === null || Array.isArray(destinations))
    return null;
  return {
    step: stored.step === 1 || stored.step === 2 ? stored.step : 0,
    baseDirectory: stored.baseDirectory,
    moveExisting: stored.moveExisting === true,
    destinations: Object.fromEntries(
      Object.entries(destinations).filter((entry) => typeof entry[1] === "string"),
    ),
    skippedProjects: new Set(stringList(stored.skippedProjects)),
    skippedChats: new Set(stringList(stored.skippedChats)),
    doneChats: new Set(stringList(stored.doneChats)),
  };
}

export function serializeDraft(
  fingerprint: string,
  fileLabel: string,
  draft: ImportDraft,
): StoredImportDraft {
  return {
    fingerprint,
    fileLabel,
    step: draft.step,
    baseDirectory: draft.baseDirectory,
    moveExisting: draft.moveExisting,
    destinations: draft.destinations,
    skippedProjects: [...draft.skippedProjects].sort(),
    skippedChats: [...draft.skippedChats].sort(),
    doneChats: [...draft.doneChats].sort(),
  };
}

let session: ImportSession | null = null;
let lastStatus = "";
let stopRequested = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function persist(current: ImportSession | null) {
  const storage = browserStorage();
  if (!storage) return;
  if (current === null) {
    storage.removeItem(DRAFT_KEY);
    return;
  }
  storage.setItem(
    DRAFT_KEY,
    JSON.stringify(serializeDraft(current.fingerprint, current.fileLabel, current.draft)),
  );
}

export function subscribeImportSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getImportSession(): ImportSession | null {
  return session;
}

export function getImportStatus(): string {
  if (session) return session.status;
  return lastStatus;
}

export function requestStopImport(): void {
  stopRequested = true;
}

export function takeStopImport(): boolean {
  const stop = stopRequested;
  stopRequested = false;
  return stop;
}

export function patchImportSession(patch: Partial<ImportSession>): void {
  if (!session) return;
  session = { ...session, ...patch };
  persist(session);
  emit();
}

export function openImportSession(input: {
  readonly bundles: readonly T3ThreadExport[];
  readonly fileLabel: string;
  readonly environmentId: EnvironmentId;
  readonly groups: readonly {
    readonly key: string;
    readonly project: { readonly id: string } | null;
  }[];
  readonly knownProjectIds: ReadonlySet<string>;
  readonly baseDirectory: string;
}): void {
  const fingerprint = importBackupFingerprint(input.bundles);
  const saved = readSavedDraft(fingerprint);
  const destinations = mergeDestinations(input.groups, saved?.destinations, input.knownProjectIds);
  const draft = saved
    ? { ...saved, destinations, baseDirectory: saved.baseDirectory || input.baseDirectory }
    : emptyDraft(destinations, input.baseDirectory);
  stopRequested = false;
  session = {
    fingerprint,
    fileLabel: input.fileLabel,
    bundles: input.bundles,
    environmentId: input.environmentId,
    draft,
    open: true,
    status: saved ? "Restored your saved choices for this backup." : "",
    busy: false,
  };
  persist(session);
  emit();
}

export function resumeImportSession(): void {
  if (!session || session.busy) return;
  session = { ...session, open: true };
  emit();
}

export function closeImportSession(): void {
  if (!session || session.busy) return;
  session = { ...session, open: false };
  persist(session);
  emit();
}

export function discardImportSession(status = ""): void {
  if (session?.busy) return;
  session = null;
  lastStatus = status;
  stopRequested = false;
  persist(null);
  emit();
}

function readSavedDraft(fingerprint: string): ImportDraft | null {
  const storage = browserStorage();
  if (!storage) return null;
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    return parseStoredDraft(JSON.parse(raw), fingerprint);
  } catch {
    return null;
  }
}

export function savedImportFileLabel(): string | null {
  const storage = browserStorage();
  if (!storage) return null;
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const fileLabel = (parsed as { fileLabel?: unknown }).fileLabel;
    return typeof fileLabel === "string" ? fileLabel : null;
  } catch {
    return null;
  }
}
