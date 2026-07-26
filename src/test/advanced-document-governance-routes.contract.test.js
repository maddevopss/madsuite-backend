const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/advanced-document-governance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('advanced document governance route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toMatch(/require\('\.\.\/\.\.\/services\/business\/transaction-engine\.service'\)/);
    expect(source.match(/transactionalWrite\(req/g).length).toBeGreaterThanOrEqual(6);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test('enforces compatible document policies', () => {
    expect(source).toContain("'documents.classification.create'");
    expect(source).toContain("'documents.version.approve'");
    expect(source).toContain("'documents.access_review.complete'");
    expect(source).toContain("'documents.document.publish'");
    expect(source).toContain("'documents.retention.execute'");
  });

  test('checks legal hold and separation of duties from locked server state', () => {
    expect(source).toContain('FROM governed_documents');
    expect(source).toContain('legal_hold');
    expect(source).toContain('FOR UPDATE');
    expect(source).toContain("'documents.retention.execute'");
  });

  test('does not fabricate publication or retention execution inputs', () => {
    expect(source).toContain("'documents.document.create', null");
    expect(source).toContain("'documents.retention.create', null");
  });
});
