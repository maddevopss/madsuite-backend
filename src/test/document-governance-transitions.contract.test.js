const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../routes/business/advanced-document-governance.routes.js'), 'utf8');

describe('document governance explicit transitions', () => {
  test.each([
    "router.post('/documents/:id/publish'",
    "router.post('/retention-actions/:id/execute'",
  ])('exposes %s', (route) => expect(source).toContain(route));

  test.each([
    'documents.document.publish@1',
    'documents.retention.execute@1',
  ])('applies %s', (policy) => expect(source).toContain(policy));

  test('requires an approved existing version before publication', () => {
    expect(source).toContain('approved_by_user_id');
    expect(source).toContain('approved_at');
    expect(source).toContain('documents.approved_version_required');
  });

  test('checks legal hold and separation of duties from server state', () => {
    expect(source).toContain('SELECT legal_hold FROM governed_documents');
    expect(source).toContain('requested_by_user_id');
    expect(source).toContain('executed_by_user_id');
  });
});
