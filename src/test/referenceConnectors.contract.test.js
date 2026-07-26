'use strict';

const { REFERENCE_CONNECTORS, activateConnector } = require('../integrations/referenceConnectors');

describe('reference connectors', () => {
  test('declares accounting, calendar, messaging, storage and transfer connectors', () => {
    expect(REFERENCE_CONNECTORS.map((item) => item.id)).toEqual([
      'accounting', 'calendar', 'messaging', 'document-storage', 'structured-transfer'
    ]);
  });

  test('requires a human decision and explicit source-of-truth approval', () => {
    const connector = REFERENCE_CONNECTORS[0];
    expect(() => activateConnector(connector, { approved: true })).toThrow('connector.human_decision.required');
    expect(() => activateConnector(connector, { approved: true, humanActorId: 'user-1', sourceOfTruth: true }))
      .toThrow('connector.source_of_truth.explicit_approval_required');
    expect(activateConnector(connector, { approved: true, humanActorId: 'user-1' }).sourceOfTruth).toBe(false);
  });
});
