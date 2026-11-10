import { scopedThreadKey, parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export interface ThreadColumn {
  id: string;
  threadRef: ScopedThreadRef;
  width: number;
}
interface ColumnLayout {
  columns: ThreadColumn[];
  activeId: string | null;
}
interface ColumnStore extends ColumnLayout {
  navigate: (ref: ScopedThreadRef) => void;
  open: (ref: ScopedThreadRef, targetId?: string, side?: "left" | "right") => void;
  move: (id: string, targetId: string, side: "left" | "right") => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  resize: (id: string, width: number) => void;
}
const empty: ColumnLayout = { columns: [], activeId: null };
const sameThread = (a: ScopedThreadRef, b: ScopedThreadRef) =>
  scopedThreadKey(a) === scopedThreadKey(b);

export function readColumnLayout(value: unknown): ColumnLayout {
  if (!value || typeof value !== "object" || !("columns" in value) || !Array.isArray(value.columns))
    return empty;
  const columns: ThreadColumn[] = [];
  for (const candidate of value.columns) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.id !== "string" ||
      typeof candidate.width !== "number" ||
      !Number.isFinite(candidate.width) ||
      candidate.width <= 0 ||
      !candidate.threadRef ||
      typeof candidate.threadRef.environmentId !== "string" ||
      typeof candidate.threadRef.threadId !== "string"
    )
      continue;
    const ref = parseScopedThreadKey(
      `${candidate.threadRef.environmentId}:${candidate.threadRef.threadId}`,
    );
    if (
      !ref ||
      columns.some((column) => column.id === candidate.id || sameThread(column.threadRef, ref))
    )
      continue;
    columns.push({ id: candidate.id, threadRef: ref, width: candidate.width });
    if (columns.length === 3) break;
  }
  const activeId =
    "activeId" in value && columns.some((column) => column.id === value.activeId)
      ? String(value.activeId)
      : (columns[0]?.id ?? null);
  return { columns, activeId };
}

export const useThreadColumnsStore = create<ColumnStore>()(
  persist(
    (set) => ({
      ...empty,
      navigate: (ref) =>
        set((state) => {
          const existing = state.columns.find((column) => sameThread(column.threadRef, ref));
          if (existing) return state.activeId === existing.id ? state : { activeId: existing.id };
          if (state.columns.length === 0) {
            const id = scopedThreadKey(ref);
            return { columns: [{ id, threadRef: ref, width: 1 }], activeId: id };
          }
          return {
            columns: state.columns.map((column) =>
              column.id === state.activeId ? { ...column, threadRef: ref } : column,
            ),
          };
        }),
      open: (ref, targetId, side = "right") =>
        set((state) => {
          const existing = state.columns.find((column) => sameThread(column.threadRef, ref));
          if (existing) return state.activeId === existing.id ? state : { activeId: existing.id };
          if (state.columns.length >= 3) return state;
          const id = scopedThreadKey(ref);
          const anchor = state.columns.findIndex(
            (column) => column.id === (targetId ?? state.activeId),
          );
          const index = Math.max(0, anchor + (side === "right" ? 1 : 0));
          const columns = [...state.columns];
          // Slot ids survive route replacements; a reopened thread can need a fresh slot id.
          let slotId = id;
          for (let suffix = 1; columns.some((column) => column.id === slotId); suffix++)
            slotId = `${id}:${suffix}`;
          columns.splice(index, 0, { id: slotId, threadRef: ref, width: 1 });
          return { columns, activeId: slotId };
        }),
      move: (id, targetId, side) =>
        set((state) => {
          if (id === targetId) return state;
          const moving = state.columns.find((column) => column.id === id);
          if (!moving || !state.columns.some((column) => column.id === targetId)) return state;
          const columns = state.columns.filter((column) => column.id !== id);
          const index =
            columns.findIndex((column) => column.id === targetId) + (side === "right" ? 1 : 0);
          columns.splice(index, 0, moving);
          return { columns };
        }),
      activate: (id) =>
        set((state) =>
          state.activeId !== id && state.columns.some((column) => column.id === id)
            ? { activeId: id }
            : state,
        ),
      close: (id) =>
        set((state) => {
          if (state.columns.length <= 1) return state;
          const index = state.columns.findIndex((column) => column.id === id);
          const columns = state.columns.filter((column) => column.id !== id);
          return {
            columns,
            activeId:
              state.activeId === id
                ? (columns[Math.max(0, index - 1)]?.id ?? null)
                : state.activeId,
          };
        }),
      resize: (id, width) =>
        set((state) =>
          !Number.isFinite(width) || width <= 0
            ? state
            : {
                columns: state.columns.map((column) =>
                  column.id === id ? { ...column, width } : column,
                ),
              },
        ),
    }),
    {
      name: "t3code:thread-columns:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ columns, activeId }) => ({ columns, activeId }),
      merge: (persisted, current) => ({ ...current, ...readColumnLayout(persisted) }),
    },
  ),
);

export function openThreadInSplit(
  ref: ScopedThreadRef,
  targetId?: string,
  side?: "left" | "right",
) {
  useThreadColumnsStore.getState().open(ref, targetId, side);
  const state = useThreadColumnsStore.getState();
  return state.columns.find((column) => column.id === state.activeId)?.threadRef ?? ref;
}
