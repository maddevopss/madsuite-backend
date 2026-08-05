jest.setTimeout(30000);

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const contractPath = path.join(__dirname, '../../openapi/stage4-contracts.yaml');
const document = YAML.parse(fs.readFileSync(contractPath, 'utf8'));

describe('stage 4 OpenAPI contract', () => {
  test('publishes a valid versioned OpenAPI document', () => {
    expect(document.openapi).toBe('3.0.3');
    expect(document.info.version).toMatch(/^1\./);
    expect(document.components).toBeDefined();
  });

  test('bounds pagination and idempotency inputs', () => {
    const parameters = document.components.parameters;
    expect(parameters.PageLimit.schema.maximum).toBe(100);
    expect(parameters.PageCursor.schema.maxLength).toBe(500);
    expect(parameters.IdempotencyKey.required).toBe(true);
    expect(parameters.IdempotencyKey.schema).toEqual(expect.objectContaining({ minLength: 8, maxLength: 200 }));
  });

  test('publishes capabilities, transitions and stable errors', () => {
    const schemas = document.components.schemas;
    expect(schemas.Capabilities.required).toEqual(expect.arrayContaining(['read', 'create', 'update', 'approve', 'close']));
    expect(schemas.TransitionRequest.properties.evidence.maxItems).toBe(20);
    expect(schemas.BusinessError.required).toEqual(['code', 'message', 'details']);
    expect(document.components.responses.InvalidTransition).toBeDefined();
  });
});
