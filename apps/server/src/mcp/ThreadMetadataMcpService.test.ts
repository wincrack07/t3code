import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationV2ServerCommand,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as McpToolAccessTestkit from "./McpToolAccess.testkit.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";

const threadId = ThreadId.make("thread:status-caller");
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:status"),
  requestNamespace: "provider:status",
  thread: {
    threadId,
    providerSessionId: "status-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};

it.effect("sets the caller's own status as one plain line and clears it when empty", () => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const shell = McpToolAccessTestkit.liveThreadShell(threadId);
  return Effect.gen(function* () {
    const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
    yield* service.update(scope, { action: "set_status", status: "  Migrating\n3 of 7\u0007 " });
    yield* service.update(scope, { action: "set_status", status: " " });
    const other = yield* service
      .update(scope, {
        action: "set_status",
        status: "Not mine",
        threadId: ThreadId.make("thread:other"),
      })
      .pipe(Effect.flip);
    assert.equal(other.code, "invalid_request");
    assert.deepEqual(
      dispatched.map((command) =>
        command.type === "thread.metadata.update" ? command.statusText : command.type,
      ),
      ["Migrating 3 of 7", null],
    );
  }).pipe(
    Effect.provide(
      ThreadMetadataMcpService.layer.pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () => Effect.succeed(shell),
            dispatch: (command) => {
              dispatched.push(command);
              return Effect.succeed({ sequence: dispatched.length, storedEvents: [] });
            },
          }),
        ),
      ),
    ),
  );
});
