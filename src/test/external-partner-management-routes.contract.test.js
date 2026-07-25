const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/external-partner-management.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('external partner management route contract', () => {
  test('routes all partner writes through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/router\.post\([\s\S]*?transactionalWrite\(req/g)).toHaveLength(5);
    expect(source).toContain('policies: policy ? [`${policy}@1`] : []');
  });

  test.each([
    'partners.partner.register',
    'partners.agreement.approve',
    'partners.certification.verify',
    'partners.assessment.complete',
    'partners.incident.report',
  ])('enforces policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('keeps draft agreements outside final approval policy', () => {
    expect(source).toContain("const approved = Boolean(req.body.approvedByUserId) || ['approved', 'active'].includes(req.body.status)");
    expect(source).toContain("approved ? 'partners.agreement.approve' : null");
  });

  test('keeps pending certifications outside verification policy', () => {
    expect(source).toContain("const verified = (req.body.verificationStatus || 'pending') === 'verified'");
    expect(source).toContain("verified ? 'partners.certification.verify' : null");
  });

  test('persists database idempotency keys supplied by the transaction', () => {
    expect(source).toMatch(/external_partner_agreements[\s\S]*idempotencyKey/);
    expect(source).toMatch(/external_partner_assessments[\s\S]*idempotencyKey/);
    expect(source).toMatch(/external_partner_incidents[\s\S]*idempotencyKey/);
  });
});
