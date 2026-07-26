'use strict';

const FORBIDDEN_RESOURCES = new Set(['postgresql.direct', 'host.filesystem', 'host.process', 'host.env']);

function evaluateSandboxRequest({ resource, contract, limits = {} }) {
  if (FORBIDDEN_RESOURCES.has(resource)) return { allowed: false, reason: 'forbidden_host_resource' };
  if (!contract?.approved) return { allowed: false, reason: 'contract_not_approved' };
  const normalized = {
    timeoutMs: Math.min(Number(limits.timeoutMs || 5000), 30000),
    memoryMb: Math.min(Number(limits.memoryMb || 64), 256),
    concurrency: Math.min(Number(limits.concurrency || 1), 10),
    networkAllowlist: [...new Set(limits.networkAllowlist || [])],
  };
  return { allowed: true, limits: normalized };
}

function shouldStopExtension({ violations = 0, timeouts = 0, memoryBreaches = 0 }) {
  return violations > 0 || timeouts >= 3 || memoryBreaches > 0;
}

module.exports = { FORBIDDEN_RESOURCES, evaluateSandboxRequest, shouldStopExtension };
