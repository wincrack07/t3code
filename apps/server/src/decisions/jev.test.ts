import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import { ProjectId, type DecisionCandidate } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { requestJevDecision } from "./jev.ts";
import { parseDecisionAnswer } from "./prompt.ts";

const candidates: DecisionCandidate[] = [
  {
    providerInstanceId: "codex",
    driver: "codex",
    model: "luna",
    effort: "low",
    effortOptionId: "reasoningEffort",
    environmentId: "local",
    projectId: "project",
  },
  {
    providerInstanceId: "claude",
    driver: "claude",
    model: "haiku",
    effort: null,
    effortOptionId: null,
    environmentId: "peer",
    projectId: "peer-project",
  },
];
const input = {
  projectId: ProjectId.make("project"),
  prompt: "Fix a typo",
  role: "implementation" as const,
};
const choice = (value = "1", confidence = 0.9) => ({
  type: "choice",
  choice: value,
  confidence,
  probabilities: { "0": 0.1, "1": 0.9 },
});
const body = () => ({
  model: "jev-1.14.0",
  answers: { model: choice(), effort: choice(), node: choice() },
  usage: { input_tokens: 200, output_tokens: 10 },
});

it.effect(
  "translates candidates to named questions and maps the answers to the original candidate",
  () =>
    Effect.gen(function* () {
      const fake = HttpClient.make((request) => {
        expect(request.url).toBe("https://api.typesafe.ai/v1/systemone");
        expect(request.headers.authorization).toBe("Bearer fake-key");
        expect(request.method).toBe("POST");
        expect(request.body._tag).toBe("Uint8Array");
        if (request.body._tag === "Uint8Array") {
          const sent = JSON.parse(new TextDecoder().decode(request.body.body));
          expect(sent.model).toBe("jev-latest");
          expect(sent.state).toEqual({
            task: "Fix a typo",
            role: "implementation",
            load: { pressure: "low" },
            candidates: [
              { model: "0", effort: "0", node: "0" },
              { model: "1", effort: "1", node: "1" },
            ],
          });
          expect(Object.keys(sent.questions)).toEqual(["model", "effort", "node"]);
          expect(sent.questions.model.type).toBe("choice");
          expect(sent.questions.model.criteria["1"]).toContain("haiku");
          expect(sent.questions.effort.criteria["0"]).toContain("low");
          expect(sent.questions.node.criteria["1"]).toContain("peer-project");
          expect(JSON.stringify(sent)).not.toContain("fake-key");
        }
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body()))),
        );
      });
      const result = yield* requestJevDecision("fake-key", "jev-latest", input, candidates, {
        pressure: "low",
      }).pipe(Effect.provideService(HttpClient.HttpClient, fake));
      expect(parseDecisionAnswer(result, candidates)?.choice).toEqual(candidates[1]);
    }),
);

it.effect.each([
  "low confidence",
  "unknown choice",
  "incompatible",
  "401",
  "429",
  "malformed JSON",
  "malformed answer",
  "missing probabilities",
] as const)("abstains on %s so the existing fallback can run", (scenario) =>
  Effect.gen(function* () {
    const response = body();
    if (scenario === "low confidence") response.answers.effort = choice("1", 0.69);
    if (scenario === "unknown choice") response.answers.model = choice("99");
    if (scenario === "incompatible") response.answers.node = choice("0");
    const payload =
      scenario === "malformed JSON"
        ? "{"
        : scenario === "malformed answer"
          ? "{}"
          : scenario === "missing probabilities"
            ? JSON.stringify({
                ...response,
                answers: {
                  ...response.answers,
                  model: { type: "choice", choice: "1", confidence: 1 },
                },
              })
            : JSON.stringify(response);
    const fake = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(payload, {
            status: scenario === "401" ? 401 : scenario === "429" ? 429 : 200,
          }),
        ),
      ),
    );
    const result = yield* requestJevDecision("fake-key", "jev-latest", input, candidates, {}).pipe(
      Effect.provideService(HttpClient.HttpClient, fake),
      Effect.option,
    );
    expect(result._tag).toBe("None");
  }),
);
