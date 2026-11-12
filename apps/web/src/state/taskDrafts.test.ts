import { describe, it, expect } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { createMemoryStorage } from "../lib/storage";
import { createTaskDraftStore } from "./taskDrafts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

describe("task draft provenance", () => {
  it("retains the home task across reload without changing the draft's destination", () => {
    const storage = createMemoryStorage();
    const thread = {
      environmentId: EnvironmentId.make("destination"),
      threadId: ThreadId.make("draft"),
    };
    const binding = {
      home: { environmentId: EnvironmentId.make("home"), projectId: ProjectId.make("project") },
      taskId: "task",
    };
    createTaskDraftStore(storage).setState({ bindings: { [scopedThreadKey(thread)]: binding } });
    expect(createTaskDraftStore(storage).getState().bindings[scopedThreadKey(thread)]).toEqual(
      binding,
    );
  });
});
