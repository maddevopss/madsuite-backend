'use strict';

function createPrincipleReference(input) {
  return Object.freeze({
    principleId: String(input.principleId || '').trim(),
    sourceRepository: input.sourceRepository || 'bleeband/SYSTEME_MAD',
    sourcePath: String(input.sourcePath || '').trim(),
    sourceVersion: String(input.sourceVersion || '').trim(),
    rationale: String(input.rationale || '').trim(),
  });
}

module.exports = { createPrincipleReference };
