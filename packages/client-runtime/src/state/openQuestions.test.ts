import { RunId, type OpenQuestion } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assembleOpenQuestionAnswers,
  nextAfterOpenQuestionAnswer,
  openQuestionAnswer,
  openQuestionDeck,
  openQuestionOptions,
} from "./openQuestions.ts";

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

describe("openQuestionOptions", () => {
  it("puts the recommended answer first, else keeps the declared order", () => {
    const merge = { ...question("merge", "Merge?"), suggestions: ["Keep reviewing", "Merge"] };
    expect(openQuestionOptions({ ...merge, recommended: "Merge" })).toEqual([
      "Merge",
      "Keep reviewing",
    ]);
    expect(openQuestionOptions(merge)).toEqual(["Keep reviewing", "Merge"]);
  });
});

describe("open question deck", () => {
  const questions = [
    question("a", "A?"),
    question("done", "Done?", "answered"),
    question("b", "B?"),
    question("c", "C?"),
  ];

  it("shows one open question at a time, falling back to the first open one", () => {
    expect(openQuestionDeck(questions, "b")).toMatchObject({ index: 1, question: { id: "b" } });
    expect(openQuestionDeck(questions, "done")?.question.id).toBe("a");
    expect(openQuestionDeck(questions, null)?.open.map((open) => open.id)).toEqual(["a", "b", "c"]);
    expect(openQuestionDeck([question("x", "X?", "dismissed")], null)).toBeNull();
  });

  it("advances to the next unanswered question, wrapping, and sends once all have answers", () => {
    const deck = openQuestionDeck(questions, "b")!;
    expect(nextAfterOpenQuestionAnswer(deck, { b: { choice: "Yes" } })).toEqual({
      kind: "show",
      id: "c",
    });
    expect(
      nextAfterOpenQuestionAnswer(deck, { b: { choice: "Yes" }, c: { choice: "No" } }),
    ).toEqual({ kind: "show", id: "a" });
    expect(
      nextAfterOpenQuestionAnswer(deck, {
        a: { choice: "Yes" },
        b: { choice: "Yes" },
        c: { choice: "No" },
      }),
    ).toEqual({ kind: "send" });
  });

  it("ties a typed reply to the shown question verbatim, alongside answers already picked", () => {
    const later = RunId.make("run:2");
    const result = assembleOpenQuestionAnswers(
      [...questions, { ...question("tests", "Run the tests?"), runId: later }],
      { a: { choice: "Yes" } },
      { id: "tests", text: "  Only the fast ones.\nSkip e2e.  " },
    );
    expect(result?.text).toBe(
      ["1 · A → Yes", "1 · Run the tests → Only the fast ones.\nSkip e2e."].join("\n"),
    );
    expect(result?.update.updates).toEqual([
      { id: "a", status: "answered", answer: "Yes" },
      { id: "tests", status: "answered", answer: "Only the fast ones. Skip e2e." },
    ]);
  });
});
