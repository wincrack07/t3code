import { describe, expect, it } from "vite-plus/test";
import { promptContinuation } from "./promptContinuation.ts";

describe("promptContinuation", () => {
  it.each([
    ["ya esta todo donde lo quiero entonces?", "Ya está todo donde lo quiero entonces?", null],
    ["ya esta", "YA ESTÁ y listo", " y listo"],
    ["ya esta todo donde lo quiero entonces?", "Ya está todo donde lo quería entonces?", null],
    ["ya esta", "Ya esta\u0301 y listo", " y listo"],
    ["ya  esta ", "Ya está y listo", "y listo"],
    ["ya esta?", "Ya está! y listo", " y listo"],
    ["Run tests", "Run tests", null],
    ["Run tests then deploy", "Run tests", null],
    ["Run tests", "Run tests, then deploy", ", then deploy"],
    ["Run tests", "Run tests...   ", null],
    ["Run tests", " and fix failures", " and fix failures"],
    ["quier", "o entonces", "o entonces"],
    ["quier", "quiero entonces", "o entonces"],
    ["Run tests\nthen deploy", "RUN tests   then deploy and report", " and report"],
    ["Run tests\nthen deploy", "then deploy and run tests", null],
    ["", "Run tests", "Run tests"],
  ] as const)("guards draft %j and suggestion %j", (draft, suggestion, expected) => {
    expect(promptContinuation(draft, suggestion)).toBe(expected);
  });
});
