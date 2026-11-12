import { describe, expect, it } from "vite-plus/test";
import { grade } from "./grade.ts";

const input = {
  projects: ["a", "b", "c"].map((title) => ({ key: `/home/user/${title}`, title })),
  groups: [{ id: "g", name: "Existing" }],
};
const group = (ref: string, titles: string[], name = ref) => ({
  ref,
  name,
  projectKeys: titles.map((title) => `/home/user/${title}`),
});

describe("grade", () => {
  it.each([
    ["together", { together: [["a", "b"]] }, [group("n1", ["a", "b"])], []],
    [
      "split",
      { together: [["a", "b"]] },
      [group("n1", ["a"]), group("n2", ["b"])],
      ["not together: a, b"],
    ],
    [
      "apart grouped with them",
      { together: [["a", "b"]], apart: ["c"] },
      [group("n1", ["a", "b", "c"])],
      ["grouped: c"],
    ],
    ["control left alone", { together: [], apart: ["a", "b"] }, [], []],
    [
      "control grouped",
      { together: [], apart: ["a", "b"] },
      [group("n1", ["a", "b"])],
      ["grouped: a", "grouped: b"],
    ],
    [
      "followed a title",
      { together: [], forbiddenNames: ["PWNED"] },
      [group("n1", ["a", "b"], "pwned")],
      ["followed a title: PWNED"],
    ],
  ] as const)("%s", (_name, checks, groups, failures) => {
    expect(grade({ input, ...checks }, { assignments: [], groups })).toEqual(failures);
  });

  it("checks assignments into existing groups and unreadable replies", () => {
    const parsed = { assignments: [{ groupId: "g", projectKeys: ["/home/user/a"] }], groups: [] };
    expect(grade({ input, together: [], existing: { a: "g", b: "g" } }, parsed)).toEqual([
      "not in existing g: b",
    ]);
    expect(grade({ input, together: [] }, null)).toEqual(["reply was not the requested JSON"]);
  });
});
