import { expect, it } from "vite-plus/test";
import { decisionPrompt, parseDecisionAnswer } from "./prompt.ts";
import { ProjectId, type DecisionCandidate } from "@t3tools/contracts";

const candidate: DecisionCandidate = {
  providerInstanceId: "personal",
  driver: "codex",
  model: "fast",
  effort: "low",
  effortOptionId: "reasoningEffort",
  environmentId: "linux",
  projectId: "app",
};
it("validates the entire answer against live candidate indices", () => {
  expect(parseDecisionAnswer('{"candidate":0,"reason":"Small task"}', [candidate])).toEqual({
    choice: candidate,
    reason: "Small task",
  });
  for (const answer of [
    '{"candidate":1,"reason":"Invented"}',
    '{"candidate":-1,"reason":"Invalid"}',
    '{"candidate":0.5,"reason":"Invalid"}',
    '{"candidate":"0","reason":"Invalid"}',
    '{"candidate":0,"reason":""}',
    '{"candidate":0,"reason":"two\\nlines"}',
    '{"candidate":0,"reason":"x","extra":true}',
    "```json\n{}\n```",
  ])
    expect(parseDecisionAnswer(answer, [candidate])).toBeUndefined();
});
it("bounds untrusted task data and includes only compact routing options", () => {
  const prompt = decisionPrompt(
    { projectId: ProjectId.make("app"), prompt: "x".repeat(20_000) },
    [candidate],
    {},
  );
  expect(prompt).toContain("untrusted data");
  expect(prompt).toContain('[0,"linux","personal","codex","fast","low"]');
  expect(prompt).not.toContain("x".repeat(12_001));
});
