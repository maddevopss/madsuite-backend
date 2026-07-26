const ALLOWED_LICENSES = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause']);

function evaluateDependency({ name, version, resolved, integrity, license, direct = false }) {
  const findings = [];
  if (!name || !version) findings.push('dependency.identity_missing');
  if (!resolved || !integrity) findings.push('dependency.lock_incomplete');
  if (license && !ALLOWED_LICENSES.has(license)) findings.push('dependency.license_review_required');
  if (direct && /^[~^]/.test(version)) findings.push('dependency.direct_range_unpinned');
  return { contract: 'supply-chain-policy@1', acceptable: findings.length === 0, findings };
}

function releaseGate(dependencies = []) {
  const results = dependencies.map(evaluateDependency);
  return { allowed: results.every((result) => result.acceptable), results };
}

module.exports = { ALLOWED_LICENSES, evaluateDependency, releaseGate };