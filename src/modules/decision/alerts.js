function buildAlert({ code, severity = 'info', title, explanation, evidence = {} }) {
  return { code, severity, title, explanation, evidence, createdAt: new Date().toISOString() };
}

module.exports = { buildAlert };
