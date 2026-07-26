function evaluateRequestBudget({ userCount = 0, organisationCount = 0, bodyBytes = 0, attachmentBytes = 0, costly = false }) {
  const limits = {
    user: costly ? 10 : 120,
    organisation: costly ? 50 : 1000,
    bodyBytes: 1024 * 1024,
    attachmentBytes: 10 * 1024 * 1024,
  };
  const violations = [];
  if (userCount >= limits.user) violations.push('abuse.user_rate_exceeded');
  if (organisationCount >= limits.organisation) violations.push('abuse.organisation_rate_exceeded');
  if (bodyBytes > limits.bodyBytes) violations.push('abuse.body_too_large');
  if (attachmentBytes > limits.attachmentBytes) violations.push('abuse.attachment_too_large');
  return { contract: 'abuse-protection@1', allowed: violations.length === 0, limits, violations };
}

module.exports = { evaluateRequestBudget };