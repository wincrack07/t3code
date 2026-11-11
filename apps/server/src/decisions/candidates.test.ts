import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DEFAULT_SERVER_SETTINGS, ProjectId, ServerProvider } from "@t3tools/contracts";
import { decisionCandidates } from "./candidates.ts";

const provider = Schema.decodeSync(ServerProvider)({
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00Z",
  models: [
    {
      slug: "fast",
      name: "Fast",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Effort",
            type: "select",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
        ],
      },
    },
  ],
});
it("excludes unreachable nodes, missing projects, disallowed accounts and unavailable providers", () => {
  const environment = {
    environmentId: "linux",
    projectId: "app",
    reachable: true,
    hasProject: true,
    providers: [provider],
  };
  const get = (patch: Partial<typeof environment> = {}, allowedInstances?: string[]) =>
    decisionCandidates(
      [{ ...environment, ...patch }],
      DEFAULT_SERVER_SETTINGS,
      ProjectId.make("app"),
      0,
      undefined,
      allowedInstances,
    );
  expect(get().map((choice) => choice.effort)).toEqual(["low", "high"]);
  expect(get({ reachable: false })).toEqual([]);
  expect(get({ hasProject: false })).toEqual([]);
  expect(get({}, [])).toEqual([]);
  expect(
    get({
      providers: [
        {
          ...provider,
          usageLimits: {
            checkedAt: provider.checkedAt,
            windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 100 }],
          },
        },
      ],
    }),
  ).toEqual([]);
  expect(
    decisionCandidates([environment], DEFAULT_SERVER_SETTINGS, ProjectId.make("app"), 0, []),
  ).toEqual([]);
  for (const patch of [
    { enabled: false },
    { installed: false },
    { availability: "unavailable" as const },
    { auth: { status: "unauthenticated" as const } },
  ])
    expect(get({ providers: [{ ...provider, ...patch }] })).toEqual([]);
});
