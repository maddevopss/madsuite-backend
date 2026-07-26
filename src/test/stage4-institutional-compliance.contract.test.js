const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');
const { contractLifecycle } = require('../utils/contractLifecycle');
const { computeServerCapabilities } = require('../utils/serverCapabilities');
const { validateTransitionInput } = require('../utils/transitionSchema');

const openapi = YAML.parse(fs.readFileSync(
  path.join(__dirname, '../../openapi/stage4-contracts.yaml'),
  'utf8',
));

const CONTRACTS = [
  'integration-list@1',
  'integration-resource@1',
  'server-capabilities@1',
  'transition@1',
];

describe('stage 4 institutional compliance', () => {
  test.each(CONTRACTS)('registers %s as an active versioned contract', (name) => {
    expect(contractLifecycle(name)).toEqual(expect.objectContaining({
      contract: name,
      deprecated: false,
      sunset: null,
      replacedBy: null,
    }));
  });

  test('keeps OpenAPI limits synchronized with transition validation', () => {
    const schema = openapi.components.schemas.TransitionRequest;
    expect(schema.properties.rationale.maxLength).toBe(2000);
    expect(schema.properties.evidence.maxItems).toBe(20);

    const req = {
      body: { rationale: 'Décision vérifiée', evidence: [{ type: 'document', id: 'preuve-1' }] },
      get: () => 'transition-compliance-1',
    };
    expect(validateTransitionInput(req)).toEqual(expect.objectContaining({
      idempotencyKey: 'transition-compliance-1',
    }));
  });

  test('keeps presentation capabilities subordinate to server policy', () => {
    const capabilities = computeServerCapabilities({
      user: { id: 10, role: 'admin' },
      resource: { created_by: 10, status: 'pending' },
      policy: { disabledActions: ['close'] },
    });
    expect(capabilities.read.allowed).toBe(true);
    expect(capabilities.approve.reason.code).toBe('approval.self_forbidden');
    expect(capabilities.close.reason.code).toBe('capability.disabled');
  });

  test('requires stable public error fields', () => {
    expect(openapi.components.schemas.BusinessError.required).toEqual([
      'code',
      'message',
      'details',
    ]);
  });
});
