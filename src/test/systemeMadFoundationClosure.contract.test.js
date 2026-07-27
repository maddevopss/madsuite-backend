'use strict';
const { evaluateSystemeMadFoundationClosure, REQUIRED_CONTROLS } = require('../services/business/systeme-mad-foundation-closure.service');
describe('SYSTEME_MAD foundation closure contract', () => {
  test('refuses closure when human authority is not preserved', () => {
    const controls = Object.fromEntries(REQUIRED_CONTROLS.map((key) => [key, true]));
    controls.human_authority_preserved = false;
    expect(evaluateSystemeMadFoundationClosure({ controls, evidence: ['proof'], approvedBy: 1 }).closeable).toBe(false);
  });
  test('accepts closure with all controls, evidence and approval', () => {
    const controls = Object.fromEntries(REQUIRED_CONTROLS.map((key) => [key, true]));
    expect(evaluateSystemeMadFoundationClosure({ controls, evidence: ['proof'], approvedBy: 1 })).toMatchObject({ closeable: true, status: 'validated' });
  });
});
