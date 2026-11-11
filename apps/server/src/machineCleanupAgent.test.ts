import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  EnvironmentId,
  ThreadId,
  ProviderInstanceId,
  type MachineCleanupState,
  type ThreadOpenQuestionsMcpInput,
} from "@t3tools/contracts";
import * as Cleanup from "./MachineCleanupService.ts";
import * as Agent from "./mcp/MachineCleanupMcpService.ts";
import * as Metadata from "./mcp/ThreadMetadataMcpService.ts";
import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { MachineCleanupAgentInput } from "@t3tools/contracts";

const decode = Schema.decodeUnknownSync(MachineCleanupAgentInput);
it("the agent action schema cannot approve or execute Phase B/C deletion", () => {
  for (const action of ["approve", "deleteApproved", "phaseB", "phaseC", "runPhaseC"]) {
    expect(() => decode({ action, itemIds: ["candidate"], reportId: "report" })).toThrow();
  }
  expect(decode({ action: "requestApproval", phase: "C" })).toEqual({
    action: "requestApproval",
    phase: "C",
  });
  expect(decode({ action: "phaseA" })).toEqual({ action: "phaseA" });
});

effectIt.effect(
  "requesting approval creates only a client review question and retains candidates",
  () =>
    Effect.gen(function* () {
      const questions: ThreadOpenQuestionsMcpInput[] = [];
      const threadId = ThreadId.make("fixture-thread");
      const state: MachineCleanupState = {
        running: false,
        progress: "Finished",
        history: [],
        report: {
          id: "fixture-report",
          mode: "scan",
          platform: "linux",
          startedAt: "2026-11-11T06:00:00Z",
          finishedAt: null,
          measurementPath: "/fixture",
          freeBefore: 1,
          freeAfter: 1,
          notes: [],
          items: [
            {
              id: "candidate",
              phase: "C",
              path: "/fixture/cache",
              rule: "fixture",
              bytes: 1,
              effect: "fixture",
              probablyActive: false,
              outcome: "pending",
              reason: "",
              project: "",
              branch: null,
              head: null,
              changes: 0,
            },
          ],
        },
      };
      const program = Effect.gen(function* () {
        const service = yield* Agent.MachineCleanupMcpService;
        const result = yield* service.execute(
          {
            environmentId: EnvironmentId.make("fixture"),
            capabilities: new Set(["orchestration"]),
            issuedAt: 0,
            requestNamespace: "fixture",
            thread: {
              threadId,
              providerSessionId: "fixture",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
            client: undefined,
          },
          { action: "requestApproval", phase: "C" },
        );
        expect(questions).toHaveLength(1);
        expect(questions[0]?.action).toBe("declare");
        expect(result.report?.items[0]?.outcome).toBe("pending");
      });
      yield* program.pipe(
        Effect.provide(
          Agent.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(Cleanup.MachineCleanup)({ current: Effect.succeed(state) }),
                Layer.mock(Metadata.ThreadMetadataMcpService)({
                  openQuestions: (_scope, input) =>
                    Effect.sync(() => {
                      questions.push(input);
                      return { threadId, open: ["machine-cleanup"] };
                    }),
                }),
              ),
            ),
          ),
        ),
      );
    }),
);
