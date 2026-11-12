import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ThreadMetadataMcpUpdateInput } from "./threadMetadataMcp.ts";

const decodeUpdate = Schema.decodeUnknownSync(ThreadMetadataMcpUpdateInput);

describe("ThreadMetadataMcpUpdateInput", () => {
  it("requires a move target and scopes worktree confirmation to moves", () => {
    const move = decodeUpdate({
      action: "move",
      moveToProjectId: "project-app",
      detachWorktree: true,
    });
    assert.equal(move.moveToProjectId, "project-app");
    assert.isTrue(move.detachWorktree);
    for (const input of [
      { action: "move" },
      { action: "rename", title: "Title", moveToProjectId: "project-app" },
      { action: "regenerate_title", detachWorktree: true },
    ])
      assert.throws(() => decodeUpdate(input));
  });

  it("rejects malformed client request ids without normalizing valid keys", () => {
    const validKey = "metadata-\ud83d\ude80-1";
    assert.equal(
      decodeUpdate({ action: "regenerate_title", clientRequestId: validKey }).clientRequestId,
      validKey,
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\ud800" }),
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\udc00" }),
    );
  });
});
