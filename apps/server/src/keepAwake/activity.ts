import type { OrchestrationV2RunStatus } from "@t3tools/contracts";

type ActivityEvent =
  | { readonly type: "thread.deleted"; readonly threadId: string }
  | {
      readonly type: "run.created" | "run.updated";
      readonly threadId: string;
      readonly payload: { readonly id: string; readonly status: OrchestrationV2RunStatus };
    };

export function updateRunActivity(runs: Map<string, string>, event: ActivityEvent) {
  if (event.type === "thread.deleted") {
    for (const [id, threadId] of runs) if (threadId === event.threadId) runs.delete(id);
  } else {
    const run = event.payload;
    if (["preparing", "queued", "starting", "running", "waiting"].includes(run.status))
      runs.set(run.id, event.threadId);
    else runs.delete(run.id);
  }
  return runs.size;
}
