const VALID_KINDS = new Set(["earning", "deduction", "employer_contribution"]);

const normalizeComponent = (input = {}) => {
  if (!VALID_KINDS.has(input.kind)) throw new Error("PAYROLL_COMPONENT_KIND_INVALID");
  if (!input.code || !input.name) throw new Error("PAYROLL_COMPONENT_IDENTITY_REQUIRED");
  return Object.freeze({
    code: String(input.code).toUpperCase(),
    name: String(input.name),
    kind: input.kind,
    taxable: Boolean(input.taxable),
    pensionable: Boolean(input.pensionable),
    insurable: Boolean(input.insurable),
    active: input.active !== false,
  });
};

module.exports = { normalizeComponent };
