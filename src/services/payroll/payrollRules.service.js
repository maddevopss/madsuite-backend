const normalizeRuleSet = (input = {}) => {
  if (!input.jurisdiction || !input.effectiveFrom) throw new Error("PAYROLL_RULESET_SCOPE_REQUIRED");
  return Object.freeze({
    jurisdiction: String(input.jurisdiction).toUpperCase(),
    version: String(input.version || input.effectiveFrom),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo || null,
    parameters: Object.freeze({ ...(input.parameters || {}) }),
  });
};

const resolveRuleSet = (ruleSets, jurisdiction, date) => {
  const target = new Date(date).getTime();
  return [...ruleSets]
    .filter((rule) => rule.jurisdiction === jurisdiction.toUpperCase())
    .filter((rule) => new Date(rule.effectiveFrom).getTime() <= target && (!rule.effectiveTo || new Date(rule.effectiveTo).getTime() >= target))
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0] || null;
};

module.exports = { normalizeRuleSet, resolveRuleSet };
