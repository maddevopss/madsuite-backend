const CONTRACT_NAME_PATTERN = /^[a-z][a-z0-9-]*@[1-9][0-9]*$/;

function assertContractName(name) {
  if (!CONTRACT_NAME_PATTERN.test(String(name || ''))) {
    const error = new Error('contract.name_invalid');
    error.code = 'contract.name_invalid';
    throw error;
  }
  return name;
}

function normalizeSunset(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('contract.sunset_invalid');
    error.code = 'contract.sunset_invalid';
    throw error;
  }
  return date.toISOString();
}

function contractLifecycle(name, options = {}) {
  const contract = assertContractName(name);
  const deprecated = options.deprecated === true;
  const sunset = normalizeSunset(options.sunset);
  const replacedBy = options.replacedBy ? assertContractName(options.replacedBy) : null;

  if ((sunset || replacedBy) && !deprecated) {
    const error = new Error('contract.deprecation_required');
    error.code = 'contract.deprecation_required';
    throw error;
  }
  if (replacedBy === contract) {
    const error = new Error('contract.replacement_same');
    error.code = 'contract.replacement_same';
    throw error;
  }

  return { contract, deprecated, sunset, replacedBy };
}

function applyContractLifecycle(meta = {}, name, options = {}) {
  return { ...meta, ...contractLifecycle(name, options) };
}

function deprecationHeaders(lifecycle) {
  if (!lifecycle?.deprecated) return {};
  const headers = { Deprecation: 'true' };
  if (lifecycle.sunset) headers.Sunset = lifecycle.sunset;
  if (lifecycle.replacedBy) headers.Link = `<${lifecycle.replacedBy}>; rel="successor-version"`;
  return headers;
}

module.exports = {
  CONTRACT_NAME_PATTERN,
  assertContractName,
  normalizeSunset,
  contractLifecycle,
  applyContractLifecycle,
  deprecationHeaders,
};
