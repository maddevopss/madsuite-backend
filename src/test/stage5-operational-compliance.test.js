const { inspectSchema } = require('../operations/schemaAssurance');
const { buildJobRegistry } = require('../operations/jobRegistry');
const { computeRetry } = require('../operations/retryPolicy');
const { prepareDelivery, reconcileDeliveries } = require('../operations/outboxDelivery');
const { summarizeHealth } = require('../operations/healthModel');
const { structuredEvent } = require('../operations/observability');
const { restorationEvidence, restorationPassed } = require('../operations/backupManifest');

describe('stage 5 operational compliance', () => {
  test('detects, contains and explains a recoverable delivery failure', () => {
    const schema = inspectSchema([{ kind: 'table', name: 'outbox_events' }], { table: ['outbox_events'] });
    const registry = buildJobRegistry([{ name: 'outbox.delivery', owner: 'platform', schedule: '* * * * *', lockKey: 'outbox_delivery', timeoutMs: 30000 }]);
    const retry = computeRetry({ attempt: 1, maxAttempts: 5 });
    const delivery = prepareDelivery({ type: 'invoice.finalized', aggregateId: 'inv-9', version: 1 });
    const health = summarizeHealth({ functional: [{ name: 'outbox', status: 'degraded', detailCode: 'outbox.pending' }] });
    const log = structuredEvent({ module: 'outbox', event: 'delivery.retry_scheduled', correlation: 'evt-12345678', data: { retry } });

    expect(schema.valid).toBe(true);
    expect(registry.jobs[0].lockKey).toBe('outbox_delivery');
    expect(retry.action).toBe('retry');
    expect(reconcileDeliveries([delivery]).pending).toBe(1);
    expect(health.status).toBe('degraded');
    expect(log.data.retry.delayMs).toBeGreaterThan(0);
  });

  test('requires verified restoration evidence before closure', () => {
    const evidence = restorationEvidence({
      manifest: {
        backupId: 'backup-final',
        createdAt: '2026-01-01T00:00:00Z',
        database: 'madsuite',
        checksum: 'sha256:final',
        storageLocation: 'vault://madsuite/backup-final',
      },
      startedAt: '2026-01-02T00:00:00Z',
      completedAt: '2026-01-02T00:15:00Z',
      restoredDatabase: 'madsuite_restore_final',
      verification: { schemaValid: true, rowCountsChecked: true, applicationSmokePassed: true },
    });
    expect(restorationPassed(evidence)).toBe(true);
  });
});
