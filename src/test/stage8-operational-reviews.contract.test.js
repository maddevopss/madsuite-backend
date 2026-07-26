const { createOperationalReview, recordDecision, closeReview } = require('../operations/operationalReview');
describe('stage 8G operational reviews', () => {
  const review = createOperationalReview({ cadence:'weekly', period:'2026-W30', owner:'operations', majorIncidents:[], changes:[], capacity:[], serviceLevels:[], risks:[] });
  test('records accountable decisions', () => expect(recordDecision(review,{ text:'augmenter la capacité', owner:'backend', dueAt:'2026-08-01', evidenceExpected:'test de charge' }).decisions).toHaveLength(1));
  test('refuses closure without follow-up', () => { const pending = recordDecision(review,{ text:'corriger', owner:'backend', dueAt:'2026-08-01', evidenceExpected:'preuve' }); expect(() => closeReview(pending,{ approvedBy:'ops', approvedAt:'2026-07-26' })).toThrow('review.follow_up_required'); });
  test('closes a review with approval', () => expect(closeReview(review,{ approvedBy:'ops', approvedAt:'2026-07-26' }).status).toBe('closed'));
});
