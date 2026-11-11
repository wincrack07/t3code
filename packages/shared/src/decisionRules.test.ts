import { describe, expect, it } from "vite-plus/test";
import type { DecisionCandidate, DecisionRule } from "@t3tools/contracts";
import { applyDecisionRules, matchesDecisionRule } from "./decisionRules.ts";

const codex: DecisionCandidate = {
  providerInstanceId: "personal",
  driver: "codex",
  model: "fast",
  effort: "low",
  effortOptionId: "reasoningEffort",
  environmentId: "linux",
  projectId: "app",
};
const claude: DecisionCandidate = { ...codex, providerInstanceId: "work", driver: "claudeAgent" };
const review: DecisionRule = {
  id: "review",
  name: "Other provider reviews",
  enabled: true,
  when: { roles: ["review"], authorDrivers: ["codex"] },
  choose: { drivers: ["claudeAgent"] },
  action: "decide",
};

describe("decision rules", () => {
  it("matches review authors, projects and instance identities without broadening missing context", () => {
    expect(
      matchesDecisionRule(review, { projectId: "app", role: "review", authorDriver: "codex" }),
    ).toBe(true);
    expect(matchesDecisionRule(review, { projectId: "app", role: "review" })).toBe(false);
    expect(
      matchesDecisionRule(
        { ...review, enabled: false },
        { projectId: "app", role: "review", authorDriver: "codex" },
      ),
    ).toBe(false);
    const personal = { ...review, when: { projectIds: ["app"], authorInstanceIds: ["personal"] } };
    expect(matchesDecisionRule(personal, { projectId: "app", authorInstanceId: "work" })).toBe(
      false,
    );
    expect(
      matchesDecisionRule(personal, { projectId: "other", authorInstanceId: "personal" }),
    ).toBe(false);
  });
  it("applies restrictions in order and stops at a terminal rule, even on an empty set", () => {
    const context = { projectId: "app", role: "review", authorDriver: "codex" } as const;
    const restrict: DecisionRule = {
      id: "personal",
      name: "Personal only",
      enabled: true,
      when: {},
      choose: { providerInstanceIds: ["personal"] },
      action: "restrict",
    };
    expect(applyDecisionRules([restrict, review], context, [codex, claude])).toEqual({
      candidates: [],
      ruleIds: ["personal", "review"],
      decided: true,
    });
    expect(applyDecisionRules([review, restrict], context, [codex, claude])).toEqual({
      candidates: [claude],
      ruleIds: ["review"],
      decided: true,
    });
  });
});
