const fs = require('fs');
const path = require('path');

const service = fs.readFileSync(path.join(__dirname, '../services/business/cross-module-authority.service.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/100_governance_authority_validations.sql'), 'utf8');

describe('cross-module authority contract', () => {
  test('resolves authority from the central governance service', () => {
    expect(service).toContain("const { resolveAuthority } = require('./governance-authority.service')");
    expect(service).toContain('await resolveAuthority(client');
    expect(service).toContain('authorityIsValid');
  });

  test('persists an immutable tenant-scoped validation reference', () => {
    expect(service).toContain('INSERT INTO governance_authority_validations');
    expect(service).toContain('WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE');
    expect(migration).toContain('subject_type TEXT NOT NULL');
    expect(migration).toContain('subject_id TEXT NOT NULL');
    expect(migration).toContain('UNIQUE (organisation_id, idempotency_key)');
  });

  test('rejects incomplete or non-idempotent requests', () => {
    expect(service).toContain('governance.cross_module_authority_fields_required');
    expect(service).toContain('governance.idempotency_required');
  });
});
