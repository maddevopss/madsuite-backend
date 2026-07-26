const SERVICE_REGISTRY_CONTRACT = 'service-registry@1';

function normalizeService(input = {}) {
  const owners = input.owners || {};
  if (!input.id || !input.name) throw new Error('service.identity_required');
  for (const role of ['business', 'technical', 'operational']) {
    if (!owners[role]) throw new Error(`service.owner_${role}_required`);
  }
  if (!['low', 'medium', 'high', 'critical'].includes(input.criticality)) {
    throw new Error('service.criticality_invalid');
  }
  return {
    contract: SERVICE_REGISTRY_CONTRACT,
    id: String(input.id),
    name: String(input.name),
    criticality: input.criticality,
    supportHours: input.supportHours || 'business-hours',
    owners,
    dependencies: [...new Set(input.dependencies || [])].sort(),
  };
}

function validateRegistry(services = []) {
  const normalized = services.map(normalizeService);
  const ids = new Set();
  for (const service of normalized) {
    if (ids.has(service.id)) throw new Error('service.duplicate');
    ids.add(service.id);
  }
  return normalized;
}

module.exports = { SERVICE_REGISTRY_CONTRACT, normalizeService, validateRegistry };
