import type { DecisionCandidate, DecisionContext, DecisionRule } from "@t3tools/contracts";

const includes = (values: ReadonlyArray<string> | undefined, value: string | undefined) =>
  values === undefined || (value !== undefined && values.includes(value));

export function matchesDecisionRule(rule: DecisionRule, context: DecisionContext): boolean {
  return (
    rule.enabled &&
    includes(rule.when.projectIds, context.projectId) &&
    includes(rule.when.roles, context.role) &&
    includes(rule.when.authorDrivers, context.authorDriver) &&
    includes(rule.when.authorInstanceIds, context.authorInstanceId)
  );
}

export function applyDecisionRules(
  rules: ReadonlyArray<DecisionRule>,
  context: DecisionContext,
  candidates: ReadonlyArray<DecisionCandidate>,
): { candidates: ReadonlyArray<DecisionCandidate>; ruleIds: string[]; decided: boolean } {
  let remaining = candidates;
  const ruleIds: string[] = [];
  for (const rule of rules) {
    if (!matchesDecisionRule(rule, context)) continue;
    ruleIds.push(rule.id);
    remaining = remaining.filter(
      (candidate) =>
        includes(rule.choose.providerInstanceIds, candidate.providerInstanceId) &&
        includes(rule.choose.drivers, candidate.driver) &&
        includes(rule.choose.models, candidate.model) &&
        includes(rule.choose.efforts, candidate.effort ?? undefined) &&
        includes(rule.choose.environmentIds, candidate.environmentId),
    );
    if (rule.action === "decide") {
      // A terminal rule picks the first live option in capability order.
      return { candidates: remaining.slice(0, 1), ruleIds, decided: true };
    }
  }
  return { candidates: remaining, ruleIds, decided: false };
}
