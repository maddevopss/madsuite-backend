'use strict';

const { evaluateSandboxRequest, shouldStopExtension } = require('../platform/extensions/extensionSandboxPolicy');

describe('stage 12C extension sandbox', () => {
  test('blocks direct database access', () => {
    expect(evaluateSandboxRequest({ resource: 'postgresql.direct', contract: { approved: true } })).toEqual({ allowed: false, reason: 'forbidden_host_resource' });
  });

  test('caps execution limits and stops abusive extensions', () => {
    const result = evaluateSandboxRequest({ resource: 'contracts.clients.read', contract: { approved: true }, limits: { timeoutMs: 99999, memoryMb: 999, concurrency: 99 } });
    expect(result.limits).toMatchObject({ timeoutMs: 30000, memoryMb: 256, concurrency: 10 });
    expect(shouldStopExtension({ violations: 1 })).toBe(true);
  });
});
