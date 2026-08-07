const { evaluateRequestBudget } = require('../security/abuseProtection');

describe('abuse protection', () => {
  test('réduit le budget des routes coûteuses', () => {
    expect(evaluateRequestBudget({ userCount: 10, costly: true }).violations).toContain('abuse.user_rate_exceeded');
  });

  test('refuse les corps et pièces trop volumineux', () => {
    const result = evaluateRequestBudget({ bodyBytes: 2 * 1024 * 1024, attachmentBytes: 11 * 1024 * 1024 });
    expect(result.allowed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining(['abuse.body_too_large', 'abuse.attachment_too_large']));
  });
});