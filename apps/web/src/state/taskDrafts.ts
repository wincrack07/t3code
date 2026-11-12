import { mergingStorage } from "../windowPersistence";
import {
  SavedTaskDraftBinding,
  type SavedTaskDraftBindings,
} from "@t3tools/client-runtime/state/tasks";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

const bindingsSchema = Schema.Record(Schema.String, SavedTaskDraftBinding);
const decodeBindings = Schema.decodeUnknownOption(Schema.Struct({ bindings: bindingsSchema }));
export const createTaskDraftStore = (storage: StateStorage) =>
  createStore<{ bindings: Record<string, SavedTaskDraftBinding> }>()(
    persist(() => ({ bindings: {} }), {
      name: "t3code:saved-task-drafts:v1",
      storage: createJSONStorage(() => storage),
      merge: (persisted, current) => {
        const result = decodeBindings(persisted);
        return result._tag === "Some" ? result.value : current;
      },
    }),
  );
const taskDraftStore = createTaskDraftStore(
  typeof localStorage === "undefined"
    ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    : mergingStorage(localStorage),
);
export const taskDrafts = {
  store: taskDraftStore,
  get: (thread: Parameters<SavedTaskDraftBindings["get"]>[0]) =>
    taskDraftStore.getState().bindings[scopedThreadKey(thread)],
  set: (thread: Parameters<SavedTaskDraftBindings["set"]>[0], binding: SavedTaskDraftBinding) =>
    taskDraftStore.setState((state) => ({
      bindings: { ...state.bindings, [scopedThreadKey(thread)]: binding },
    })),
};
