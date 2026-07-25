const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/advanced-document-governance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('advanced document governance route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(6);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test('enforces compatible document policies', () => {
    expect(source).toContain("'documents.classification.create'");
    expect(source).toContain("'documents.version.approve'");
    expect(source).toContain("'documents.access_review.complete'");
  });

  test('checks legal hold and separation of duties from locked server state', () => {
    expect(source).toContain('SELECT legal_hold FROM governed_documents WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
    expect(source).toContain('documents.legal_hold_blocks_destruction');
    expect(source).toContain('documents.retention_separation_of_duties_required');
  });

  test('does not fabricate publication or retention execution inputs', () => {
    expect(source).toContain("'documents.document.create', null");
    expect(source).toContain("'documents.retention.create', null");
  });
});
