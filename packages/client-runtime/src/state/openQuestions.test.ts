import { RunId, type OpenQuestion } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { assembleOpenQuestionAnswers, openQuestionAnswer } from "./openQuestions.ts";

const runId = RunId.make("run:1");
const question = (id: string, text: string, status: OpenQuestion["status"] = "open") =>
  ({
    id,
    text,
    suggestions: ["Yes", "No"],
    runId,
    status,
    createdAt: "2026-11-11T00:00:00.000Z",
  }) satisfies OpenQuestion;

describe("assembleOpenQuestionAnswers", () => {
  it("numbers answers by card, joins chip and detail, and leaves the rest open", () => {
    const questions = [
      question("fix", "The one-cent rejection: do I open it as its own **fix**?"),
      question("merge", "Merge `dev` into `main` before Nov 14?"),
      question("adapter", "Launch fe-adapter on main."),
      question("audio", "Should I research [credit sales](https://example.com)?"),
      question("old", "Already handled?", "answered"),
    ];
    const result = assembleOpenQuestionAnswers(questions, {
      fix: { choice: "Yes, open it" },
      merge: { choice: "Wait", detail: "  do it on the 13th\nin the morning " },
      adapter: { detail: "" },
      audio: { choice: "Yes", later: true },
      old: { choice: "Yes" },
    });
    expect(result?.text).toBe(
      [
        "1 · The one-cent rejection → Yes, open it",
        "2 · Merge dev into main before Nov 14 → Wait: do it on the 13th in the morning",
      ].join("\n"),
    );
    expect(result?.update.updates).toEqual([
      { id: "fix", status: "answered", answer: "Yes, open it" },
      { id: "merge", status: "answered", answer: "Wait: do it on the 13th in the morning" },
    ]);
  });

  it("sends nothing when no card has an answer", () => {
    expect(assembleOpenQuestionAnswers([question("a", "A?")], { a: { detail: " " } })).toBeNull();
    expect(openQuestionAnswer({ detail: "custom answer" })).toBe("custom answer");
  });
});
