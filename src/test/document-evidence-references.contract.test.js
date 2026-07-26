const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/document-evidence-references.routes.js'), 'utf8');
const documentRoute = fs.readFileSync(path.join(__dirname, '../routes/business/advanced-document-governance.routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/096_document_evidence_references.sql'), 'utf8');

describe('document evidence references contract', () => {
  test('uses aggregate type and id without copying source records', () => {
    expect(migration).toContain('aggregate_type TEXT NOT NULL');
    expect(migration).toContain('aggregate_id BIGINT NOT NULL');
    expect(documentRoute).toContain("router.use('/evidence-references', documentEvidenceReferenceRoutes)");
  });

  test('validates document and optional version under organisation locks', () => {
    expect(route).toContain('governed_documents WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
    expect(route).toContain('governed_document_versions WHERE id=$1 AND document_id=$2 AND organisation_id=$3 FOR UPDATE');
  });

  test('creates the reference transactionally and idempotently', () => {
    expect(route).toContain("type: 'integration.document_evidence_reference.create'");
    expect(route).toContain('idempotencyKey');
    expect(route).not.toMatch(/db\.pool\.query\([^)]*(?:INSERT|UPDATE|DELETE)/s);
  });
});
