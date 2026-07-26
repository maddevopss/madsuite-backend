const STATUSES = new Set(['approved', 'experimental', 'forbidden']);
const AUTONOMY = new Set(['advisory', 'draft_only']);

function validateUseCase(entry) {
  if (!entry || !entry.id || !entry.version || !entry.owner) throw new Error('ai.use_case.identity_required');
  if (!STATUSES.has(entry.status)) throw new Error('ai.use_case.status_invalid');
  if (!AUTONOMY.has(entry.autonomy)) throw new Error('ai.use_case.autonomy_invalid');
  if (!Array.isArray(entry.dataClasses) || entry.dataClasses.length === 0) throw new Error('ai.use_case.data_classes_required');
  if (!entry.riskLevel) throw new Error('ai.use_case.risk_required');
  return Object.freeze({ ...entry, contract: 'assisted-use-case@1' });
}

function createUseCaseRegistry(entries = []) {
  const registry = new Map();
  for (const raw of entries) {
    const entry = validateUseCase(raw);
    const key = `${entry.id}@${entry.version}`;
    if (registry.has(key)) throw new Error('ai.use_case.duplicate');
    registry.set(key, entry);
  }
  return {
    contract: 'assisted-use-case-registry@1',
    get(id, version) { return registry.get(`${id}@${version}`) || null; },
    canActivate(id, version) { return registry.get(`${id}@${version}`)?.status === 'approved'; },
    list() { return [...registry.values()]; },
  };
}

module.exports = { validateUseCase, createUseCaseRegistry };
