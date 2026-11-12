import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectGroupSuggestionInput,
  ProviderInstanceId,
  ServerProvider,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectGroupSuggestions from "./ProjectGroupSuggestions.ts";

const input: ProjectGroupSuggestionInput = {
  // Keys from two environments; the server only echoes them back.
  projects: [
    { key: "env-a:/home/user/billing-api", title: "billing-api", repository: "acme/billing-api" },
    { key: "env-b:/srv/billing-web", title: "billing-web", repository: "acme/billing-web" },
    { key: "env-a:/home/user/dotfiles", title: "dotfiles" },
    { key: "env-b:/srv/blog", title: "blog" },
  ],
  groups: [
    { id: "clients", name: "Clients" },
    { id: "acme", name: "Acme", parentId: "clients" },
  ],
};
const decodeProvider = Schema.decodeSync(ServerProvider);
const [billingApi, billingWeb, dotfiles, blog] = input.projects.map((project) => project.key);
const parse = (reply: unknown) =>
  ProjectGroupSuggestions.parseProjectGroupSuggestion(input, JSON.stringify(reply));

describe("parseProjectGroupSuggestion", () => {
  it("maps short ids back to the input's keys and groups", () => {
    expect(
      parse({
        existing: [{ group: "g2", projects: ["p1"] }],
        new: [
          { id: "n1", name: " Billing ", parent: "g2", projects: ["p2"] },
          { id: "n2", name: "Personal", parent: null, projects: ["p3", "p4"] },
        ],
      }),
    ).toEqual({
      assignments: [{ groupId: "acme", projectKeys: [billingApi] }],
      groups: [
        { ref: "n1", name: "Billing", parentGroupId: "acme", projectKeys: [billingWeb] },
        { ref: "n2", name: "Personal", projectKeys: [dotfiles, blog] },
      ],
    });
  });

  it("drops unknown ids, second claims, bad names, cycles and empty groups", () => {
    expect(
      parse({
        existing: [
          { group: "g9", projects: ["p1"] },
          { group: "g1", projects: ["p9", "p1", "p1"] },
        ],
        new: [
          { id: "n1", name: "Twice", projects: ["p1", "p2"] },
          { id: "n1", name: "Duplicate id", projects: ["p3"] },
          { id: "n2", name: "x".repeat(41), projects: ["p3"] },
          { id: "n3", name: "  ", projects: ["p3"] },
          { id: "n4", name: "Misc", projects: ["p3"] },
          { id: "n5", name: "Loop A", parent: "n6", projects: ["p3"] },
          { id: "n6", name: "Loop B", parent: "n5", projects: ["p4"] },
          { id: "n7", name: "Off the loop", parent: "n5", projects: [] },
          { id: "n8", name: "Self", parent: "n8", projects: ["p4"] },
          { id: "n9", name: "Empty", projects: ["p9"] },
          { id: "n10", name: "twice", projects: ["p4"] },
        ],
      }),
    ).toEqual({
      assignments: [{ groupId: "clients", projectKeys: [billingApi] }],
      groups: [{ ref: "n1", name: "Twice", projectKeys: [billingWeb] }],
    });
  });

  it("keeps a parent that only holds groups, lifts unknown parents, and merges same-named groups", () => {
    expect(
      parse({
        new: [
          { id: "n2", name: "Web", parent: "n1", projects: ["p2"] },
          { id: "n1", name: "Billing", projects: [] },
          { id: "n3", name: "clients", projects: ["p3"] },
          { id: "n4", name: "Docs", parent: "zz", projects: ["p4"] },
        ],
      }),
    ).toEqual({
      assignments: [{ groupId: "clients", projectKeys: [dotfiles] }],
      groups: [
        { ref: "n1", name: "Billing", projectKeys: [] },
        { ref: "n2", name: "Web", parentRef: "n1", projectKeys: [billingWeb] },
        { ref: "n4", name: "Docs", projectKeys: [blog] },
      ],
    });
  });

  it("reads JSON wrapped in prose or a fence and rejects anything else", () => {
    expect(
      ProjectGroupSuggestions.parseProjectGroupSuggestion(
        input,
        '```json\n{"new":[{"id":"n1","name":"Billing","projects":["p1","p2"]}]}\n```',
      )?.groups,
    ).toHaveLength(1);
    expect(ProjectGroupSuggestions.parseProjectGroupSuggestion(input, "No groups.")).toBeNull();
    expect(parse({ new: [{ id: 1, name: "Billing" }] })).toBeNull();
  });

  it("shows the model titles and repositories under short ids, never keys or paths", () => {
    const prompt = ProjectGroupSuggestions.buildProjectGroupSuggestionPrompt(input);
    expect(prompt).toContain("p1: billing-api (acme/billing-api)");
    expect(prompt).toContain("g2: Acme (inside g1)");
    expect(prompt).not.toContain("/home/user");
    expect(prompt).not.toContain("env-a");
  });
});

it("caps the request at the documented number of projects", () => {
  const project = { key: "k", title: "t" };
  const decode = Schema.decodeUnknownExit(ProjectGroupSuggestionInput);
  expect(decode({ projects: Array.from({ length: 100 }, () => project), groups: [] })._tag).toBe(
    "Success",
  );
  expect(decode({ projects: Array.from({ length: 101 }, () => project), groups: [] })._tag).toBe(
    "Failure",
  );
});

const service = (
  generate: TextGeneration.TextGeneration["Service"]["generateTranscriptionPostProcessing"],
) =>
  ProjectGroupSuggestions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            textGenerationModelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: "claude-haiku",
            },
          }),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([
            decodeProvider({
              instanceId: "claudeAgent",
              driver: "claudeAgent",
              enabled: true,
              installed: true,
              version: null,
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-01-01T00:00:00Z",
              models: [
                { slug: "claude-haiku", name: "Claude Haiku", isCustom: false, capabilities: {} },
              ],
            }),
          ]),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: generate,
        }),
      ),
    ),
  );
const suggest = ProjectGroupSuggestions.ProjectGroupSuggestions.pipe(
  Effect.flatMap((suggestions) => suggestions.suggest(input)),
);

it.effect("names the text generation model that produced the suggestion", () =>
  Effect.gen(function* () {
    const result = yield* suggest.pipe(
      Effect.provide(
        service(() =>
          Effect.succeed({
            transcription: '{"new":[{"id":"n1","name":"Billing","projects":["p1","p2"]}]}',
          }),
        ),
      ),
    );
    expect(result).toEqual({
      _tag: "Suggested",
      model: "Claude Haiku",
      assignments: [],
      groups: [{ ref: "n1", name: "Billing", projectKeys: [billingApi, billingWeb] }],
    });
  }),
);

it.effect("reports a failed or unreadable generation as unavailable", () =>
  Effect.gen(function* () {
    const failed = yield* suggest.pipe(
      Effect.provide(
        service(() =>
          Effect.fail(
            new TextGenerationError({
              operation: "generateTranscriptionPostProcessing",
              detail: "no provider",
            }),
          ),
        ),
      ),
    );
    expect(failed).toEqual({ _tag: "Unavailable", reason: "failed" });
    const invalid = yield* suggest.pipe(
      Effect.provide(service(() => Effect.succeed({ transcription: "Sure! Here are groups." }))),
    );
    expect(invalid).toEqual({ _tag: "Unavailable", reason: "invalid-output" });
  }),
);
