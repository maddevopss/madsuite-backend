const SENSITIVE_TITLE_PATTERNS = [
  /password/i,
  /mot de passe/i,
  /secret/i,
  /token/i,
  /api[_ -]?key/i,
  /private key/i,
  /carte de cr[e\u00e9]dit/i,
  /credit card/i,
  /bearer/i,
  /authorization/i,
  /nas/i,
  /sin/i,
  /assurance sociale/i,
];

function maskSensitiveValue(value, fallback, maxLength) {
  const safeValue = String(value || "").trim();

  if (!safeValue) return fallback;
  if (SENSITIVE_TITLE_PATTERNS.some((pattern) => pattern.test(safeValue))) {
    return "[masque]";
  }

  return safeValue.slice(0, maxLength);
}

function sanitizeWindowTitle(title = "") {
  return maskSensitiveValue(title, "", 500);
}

function sanitizeAppName(appName = "") {
  return maskSensitiveValue(appName, "Unknown", 255);
}

module.exports = {
  sanitizeAppName,
  sanitizeWindowTitle,
};
