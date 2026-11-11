import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { OpenQuestionDeclaration, StoredOpenQuestions } from "./threadOpenQuestions.ts";

const decodeDeclaration = Schema.decodeUnknownSync(OpenQuestionDeclaration);
const decodeStored = Schema.decodeUnknownSync(StoredOpenQuestions);

describe("OpenQuestionDeclaration", () => {
  it("takes a recommended answer only when it is one of the suggestions", () => {
    const question = { id: "merge", text: "Merge?", suggestions: ["Merge", "Wait"] };
    expect(decodeDeclaration({ ...question, recommended: "Wait" }).recommended).toBe("Wait");
    expect(() => decodeDeclaration({ ...question, recommended: "Ship it" })).toThrow(
      "`recommended` must equal one of the suggestions.",
    );
  });

  it("still reads questions stored before context and recommended existed", () => {
    const stored = {
      id: "merge",
      text: "Merge?",
      suggestions: ["Merge", "Wait"],
      runId: null,
      status: "open",
      createdAt: "2026-11-11T00:00:00.000Z",
    };
    expect(decodeStored([stored])).toEqual([stored]);
  });
});
