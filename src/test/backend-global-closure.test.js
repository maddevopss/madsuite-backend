'use strict';

const {
  REQUIRED_BLOCKS,
  evaluateBackendGlobalClosure,
} = require('../services/backendGlobalClosure.service');

function closedBlocks() {
  return Object.fromEntries(REQUIRED_BLOCKS.map((block) => [block, 'closed']));
}

describe('backend global closure', () => {
  test('refuse la fermeture lorsqu’un bloc obligatoire demeure ouvert', () => {
    const blockStatus = closedBlocks();
    blockStatus.inventory = 'open';

    const result = evaluateBackendGlobalClosure({
      blockStatus,
      evidence: [{ type: 'ci', status: 'passed' }],
      humanApproved: true,
      migrationsValidated: true,
      securityValidated: true,
      contractTestsValidated: true,
    });

    expect(result.closable).toBe(false);
    expect(result.missingBlocks).toContain('inventory');
    expect(result.reasons).toContain('required_blocks_not_closed');
  });

  test('refuse la fermeture sans preuves et approbation humaine', () => {
    const result = evaluateBackendGlobalClosure({
      blockStatus: closedBlocks(),
      unresolvedDependencies: [],
      migrationsValidated: true,
      securityValidated: true,
      contractTestsValidated: true,
    });

    expect(result.closable).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['missing_evidence', 'missing_human_approval'])
    );
  });

  test('autorise la fermeture lorsque tous les contrôles sont validés', () => {
    const result = evaluateBackendGlobalClosure({
      blockStatus: closedBlocks(),
      unresolvedDependencies: [],
      evidence: [
        { type: 'ci', status: 'passed' },
        { type: 'security', status: 'passed' },
      ],
      humanApproved: true,
      migrationsValidated: true,
      securityValidated: true,
      contractTestsValidated: true,
    });

    expect(result).toMatchObject({
      closable: true,
      reasons: [],
      missingBlocks: [],
    });
  });
});
