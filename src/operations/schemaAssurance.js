const REQUIRED_KINDS = ['table', 'index', 'constraint', 'policy'];

function normalizeRequirement(requirement = {}) {
  const kind = String(requirement.kind || '').trim().toLowerCase();
  const name = String(requirement.name || '').trim();
  if (!REQUIRED_KINDS.includes(kind) || !name) {
    throw new Error('schema.requirement.invalid');
  }
  return { kind, name, repairable: requirement.repairable !== false };
}

function inspectSchema(requirements = [], observed = {}) {
  const normalized = requirements.map(normalizeRequirement);
  const missing = normalized.filter(({ kind, name }) => !new Set(observed[kind] || []).has(name));
  return {
    contract: 'schema-assurance@1',
    valid: missing.length === 0,
    missing,
    repairable: missing.filter((item) => item.repairable),
    blocked: missing.filter((item) => !item.repairable),
  };
}

function assertSchema(report) {
  if (!report || report.contract !== 'schema-assurance@1') {
    throw new Error('schema.report.invalid');
  }
  if (!report.valid) {
    const error = new Error('schema.incomplete');
    error.code = 'schema.incomplete';
    error.details = { missing: report.missing };
    throw error;
  }
  return true;
}

module.exports = { REQUIRED_KINDS, normalizeRequirement, inspectSchema, assertSchema };
