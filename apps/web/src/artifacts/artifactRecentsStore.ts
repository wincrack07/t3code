import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

import { parseClaudeArtifactUrl } from "./claudeArtifactUrl";

const ARTIFACT_RECENTS_LIMIT = 12;

export interface RecentArtifact {
  readonly id: string;
  readonly url: string;
  readonly openedAt: number;
}

interface ArtifactRecentsState {
  readonly recents: ReadonlyArray<RecentArtifact>;
  readonly record: (url: string, at?: number) => void;
  readonly clear: () => void;
}

function addRecentArtifact(
  recents: ReadonlyArray<RecentArtifact>,
  url: string,
  at: number,
): ReadonlyArray<RecentArtifact> {
  const link = parseClaudeArtifactUrl(url);
  if (link === null) return recents;
  return [
    { id: link.id, url: link.url, openedAt: at },
    ...recents.filter((entry) => entry.id !== link.id),
  ].slice(0, ARTIFACT_RECENTS_LIMIT);
}

/** Artifacts this client opened, from the Artifacts section or chat links, newest first. */
export const useArtifactRecentsStore = create<ArtifactRecentsState>()(
  persist(
    (set) => ({
      recents: [],
      record: (url, at = Date.now()) =>
        set((state) => ({ recents: addRecentArtifact(state.recents, url, at) })),
      clear: () => set({ recents: [] }),
    }),
    {
      name: "t3code:artifact-recents:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ recents }) => ({ recents }),
      merge: (persisted, current) => {
        const stored = (persisted as { recents?: unknown } | undefined)?.recents;
        const recents = Array.isArray(stored)
          ? stored.flatMap((entry: unknown) => {
              const candidate = entry as Partial<RecentArtifact> | null;
              return typeof candidate?.url === "string" && typeof candidate.openedAt === "number"
                ? addRecentArtifact([], candidate.url, candidate.openedAt)
                : [];
            })
          : [];
        return { ...current, recents: recents.slice(0, ARTIFACT_RECENTS_LIMIT) };
      },
    },
  ),
);

export const recordRecentArtifact = (url: string): void =>
  useArtifactRecentsStore.getState().record(url);
