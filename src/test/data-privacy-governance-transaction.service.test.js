const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  PROCESSING_CREATE_POLICY,
  CONSENT_RECORD_POLICY,
  SUBJECT_REQUEST_TRANSITION_POLICY,
  INCIDENT_RECORD_POLICY,
  INCIDENT_CLOSE_POLICY,
  RETENTION_COMPLETE_POLICY,
} = require('../services/business/data-privacy-governance-transaction.service');

const evaluate = (policy, input, idempotencyKey = 'privacy-test-001') => evaluatePolicy({ policy, input, idempotencyKey });

describe('data privacy governance transaction policies', () => {
  test('refuse une activité sans catégories de données ni personnes concernées', async () => {
    const result = await evaluate(PROCESSING_CREATE_POLICY, { activityNumber:'PA-001', name:'Facturation', purpose:'Produire les factures', legalBasis:'contrat', retentionPeriodDays:2555, ownerUserId:42, nextReviewAt:'2027-01-01T00:00:00Z', dataCategories:[], subjectCategories:[] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('privacy.processing_scope_required');
  });

  test('refuse un consentement accordé sans preuve', async () => {
    const result = await evaluate(CONSENT_RECORD_POLICY, { subjectReference:'client-1', purpose:'communications', source:'formulaire', status:'granted', proof:[] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('privacy.consent_proof_required');
  });

  test('refuse une demande complétée sans réponse ni preuve', async () => {
    const result = await evaluate(SUBJECT_REQUEST_TRANSITION_POLICY, { requestNumber:'REQ-001', requestType:'access', subjectReference:'client-1', ownerUserId:42, dueAt:'2026-08-25T00:00:00Z', status:'completed', identityVerification:['preuve-id'], responseSummary:'', evidence:[] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('privacy.request_completion_proof_required');
  });

  test('refuse un incident critique sans données touchées ni journal', async () => {
    const result = await evaluate(INCIDENT_RECORD_POLICY, { incidentNumber:'PRI-001', title:'Fuite', description:'Exposition', ownerUserId:42, severity:'critical', affectedData:[], decisionLog:[] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('privacy.major_incident_proof_required');
  });

  test('refuse la fermeture sans cause, leçons et preuve', async () => {
    const result = await evaluate(INCIDENT_CLOSE_POLICY, { incidentId:1, rootCause:'', lessonsLearned:'', evidence:[] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('privacy.incident_closure_proof_required');
  });

  test('refuse une action de rétention complétée sans résultat ni preuve', async () => {
    const result = await evaluate(RETENTION_COMPLETE_POLICY, { processingActivityId:1, actionNumber:'RET-001', actionType:'delete', status:'completed', result:'', evidence:[] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('privacy.retention_completion_proof_required');
  });
});
