import { ProviderInstanceId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { claimDelayMs, decideClaim, formatClaimMarker, headClaimKey } from "./claims.ts";
import { nextPollDelayMs, rateLimitRetryAtMs } from "./pollingBackoff.ts";
import { mapFindingsToComments, parseReviewOutput, type ReviewFinding } from "./reviewFindings.ts";
import { detectAuthorProvider, selectReviewer } from "./reviewerRules.ts";
import { isAllowedRequester, isIgnoredAuthor, parseReviewCommand } from "./triggers.ts";

describe("parseReviewCommand", () => {
  it.each([
    ["@t3 review", { focus: "" }],
    ["@T3  Review please focus on the cache", { focus: "please focus on the cache" }],
    ["thanks!\n@t3 review: security\nand auth", { focus: "security\nand auth" }],
    ["> @t3 review\nquoted only", null],
    ["```\n@t3 review\n```", null],
    ["run `@t3 review` to ask", null],
    ["@t3reviewer review", null],
    ["@t3 reviewed this already", null],
    ["email me@t3 review", null],
    ["<!-- t3-review sha=abc -->\n@t3 review", null],
  ])("%j", (body, expected) => {
    expect(parseReviewCommand(body, "@t3 review")).toEqual(expected);
  });
});

describe("requesters", () => {
  it("ignores the bot itself, other bots and marked comments", () => {
    expect(isIgnoredAuthor({ login: "t3-review[bot]", type: "Bot" }, "x", "t3-review[bot]")).toBe(
      true,
    );
    expect(isIgnoredAuthor({ login: "Maintainer" }, "x", "maintainer")).toBe(true);
    expect(isIgnoredAuthor({ login: "dependabot[bot]" }, "@t3 review", null)).toBe(true);
    expect(isIgnoredAuthor({ login: "alice" }, "<!-- t3-review-claim ... -->", null)).toBe(true);
    expect(isIgnoredAuthor({ login: "alice", type: "User" }, "@t3 review", "bot")).toBe(false);
  });

  it("defaults to write access and lets an explicit list replace it", () => {
    expect(isAllowedRequester({ login: "a", allowedLogins: [], permission: "write" })).toBe(true);
    expect(isAllowedRequester({ login: "a", allowedLogins: [], permission: "read" })).toBe(false);
    expect(isAllowedRequester({ login: "a", allowedLogins: [], permission: null })).toBe(false);
    expect(isAllowedRequester({ login: "Bob", allowedLogins: ["bob"], permission: null })).toBe(
      true,
    );
    expect(isAllowedRequester({ login: "a", allowedLogins: ["bob"], permission: "admin" })).toBe(
      false,
    );
  });
});

describe("decideClaim", () => {
  const key = headClaimKey("ABC123");
  const now = Date.parse("2026-11-11T12:00:00Z");
  const claim = (id: number, state: "active" | "done" | "failed", at: string, trusted = true) => ({
    id,
    trusted,
    body: `T3 is reviewing.\n${formatClaimMarker({ key, environmentId: `env-${id}`, state, at })}`,
  });
  const decide = (comments: ReturnType<typeof claim>[]) =>
    decideClaim({ key, comments, nowMs: now, leaseMs: 45 * 60_000 });

  it("gives the head to the earliest live claim, whoever reads it", () => {
    const comments = [
      claim(20, "active", "2026-11-11T11:59:00Z"),
      claim(10, "active", "2026-11-11T11:59:30Z"),
    ];
    expect(decide(comments)).toEqual({ kind: "held", commentId: 10, environmentId: "env-10" });
    expect(decide(comments.toReversed())).toEqual(decide(comments));
  });

  it("never reviews a finished head again", () => {
    expect(
      decide([
        claim(5, "done", "2026-01-01T00:00:00Z"),
        claim(9, "active", "2026-11-11T11:59:00Z"),
      ]),
    ).toEqual({
      kind: "done",
      commentId: 5,
    });
  });

  it("frees a head whose claim expired, failed, or was written by an untrusted account", () => {
    expect(decide([claim(1, "active", "2026-11-11T10:00:00Z")])).toEqual({ kind: "free" });
    expect(decide([claim(1, "failed", "2026-11-11T11:59:00Z")])).toEqual({ kind: "free" });
    expect(decide([claim(1, "done", "2026-11-11T11:59:00Z", false)])).toEqual({ kind: "free" });
    expect(decide([{ id: 2, trusted: true, body: "@t3 review" }])).toEqual({ kind: "free" });
  });

  it("staggers fallbacks by priority", () => {
    expect([0, 1, 2].map((priority) => claimDelayMs(priority, 90))).toEqual([0, 90_000, 180_000]);
  });
});

describe("author provider and reviewer rules", () => {
  const claude = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" };
  const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" };
  const rules = [
    { authorProvider: "codex", reviewer: claude },
    { authorProvider: "claudeAgent", reviewer: codex },
  ];

  it("prefers the T3 thread, then trailers, then unknown", () => {
    expect(
      detectAuthorProvider({
        threadProviders: ["codex"],
        commitMessages: ["x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
      }),
    ).toEqual({ provider: "codex", source: "thread" });
    expect(
      detectAuthorProvider({
        threadProviders: [],
        commitMessages: [
          "a\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
          "b\n\nco-authored-by: Codex <codex@openai.com>",
          "c\n\nCo-authored-by: Claude <noreply@anthropic.com>",
        ],
      }),
    ).toEqual({ provider: "claudeAgent", source: "trailer" });
    expect(detectAuthorProvider({ threadProviders: [], commitMessages: ["fix: x"] })).toEqual({
      provider: "unknown",
      source: "unknown",
    });
  });

  it("crosses providers and falls back to the default", () => {
    expect(selectReviewer({ rules, defaultReviewer: null, authorProvider: "codex" })).toEqual({
      reviewer: claude,
      ruleIndex: 0,
    });
    expect(selectReviewer({ rules, defaultReviewer: null, authorProvider: "claudeAgent" })).toEqual(
      { reviewer: codex, ruleIndex: 1 },
    );
    expect(selectReviewer({ rules, defaultReviewer: codex, authorProvider: "unknown" })).toEqual({
      reviewer: codex,
      ruleIndex: null,
    });
    expect(
      selectReviewer({
        rules: [{ authorProvider: "any", reviewer: claude }, ...rules],
        defaultReviewer: codex,
        authorProvider: "codex",
      }).ruleIndex,
    ).toBe(0);
  });
});

describe("review findings", () => {
  const patch = [
    "@@ -10,4 +10,5 @@ export function load() {",
    "   const a = 1;",
    "-  const b = 2;",
    "+  const b = 3;",
    "+  const c = b * 2;",
    "   return a;",
    "@@ -40,2 +41,2 @@",
    "-  old();",
    "+  next();",
    "   done();",
  ].join("\n");
  const finding = (overrides: Partial<ReviewFinding>): ReviewFinding => ({
    path: "src/load.ts",
    line: 11,
    severity: "high",
    title: "Wrong constant",
    body: "b doubles.",
    ...overrides,
  });

  it("places findings on the right line and side, and keeps the rest for the summary", () => {
    const { comments, unplaced } = mapFindingsToComments(
      [
        finding({ line: 12, startLine: 11, failureScenario: "load() returns 6" }),
        finding({ path: "./src/load.ts", line: 11, side: "LEFT" }),
        finding({ line: 41, startLine: 12 }),
        finding({ line: 30 }),
        finding({ path: "missing.ts" }),
      ],
      [{ filename: "src/load.ts", patch }, { filename: "logo.png" }],
    );
    expect(comments.map(({ body: _body, ...rest }) => rest)).toEqual([
      { path: "src/load.ts", line: 12, side: "RIGHT", start_line: 11, start_side: "RIGHT" },
      { path: "src/load.ts", line: 11, side: "LEFT" },
      // The start sits in another hunk, so GitHub would refuse the range.
      { path: "src/load.ts", line: 41, side: "RIGHT" },
    ]);
    expect(comments[0]!.body).toContain("_Failure scenario:_ load() returns 6");
    expect(unplaced.map((item) => item.line)).toEqual([30, 11]);
  });

  it("reads the last t3-review block and rejects malformed output", () => {
    const output = { summary: "One bug.", findings: [finding({})] };
    const text = `Draft:\n\`\`\`t3-review\n{}\n\`\`\`\nFinal:\n\`\`\`t3-review\n${JSON.stringify(output)}\n\`\`\``;
    expect(parseReviewOutput(text)).toEqual(Option.some(output));
    expect(Option.isNone(parseReviewOutput('```t3-review\n{"summary": 1}\n```'))).toBe(true);
    expect(Option.isNone(parseReviewOutput("LGTM"))).toBe(true);
  });
});

describe("polling backoff", () => {
  const now = 1_000_000;
  it("polls each minute, doubles on failure up to 15 minutes, and honors rate limits", () => {
    expect(nextPollDelayMs({ failures: 0 }, now)).toBe(60_000);
    expect(nextPollDelayMs({ failures: 2 }, now)).toBe(240_000);
    expect(nextPollDelayMs({ failures: 9 }, now)).toBe(900_000);
    expect(nextPollDelayMs({ failures: 1, retryAtMs: now + 3_600_000 }, now)).toBe(3_601_000);
  });

  it("reads GitHub's retry signals", () => {
    expect(rateLimitRetryAtMs({ status: 429, headers: { "retry-after": "30" }, nowMs: now })).toBe(
      now + 30_000,
    );
    expect(
      rateLimitRetryAtMs({
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000" },
        nowMs: now,
      }),
    ).toBe(2_000_000);
    expect(rateLimitRetryAtMs({ status: 403, headers: {}, nowMs: now })).toBeUndefined();
    expect(rateLimitRetryAtMs({ status: 500, headers: {}, nowMs: now })).toBeUndefined();
  });
});
