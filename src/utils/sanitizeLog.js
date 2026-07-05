const SENSITIVE_QUERY_KEY_PATTERNS = [
  "token",
  "secret",
  "password",
  "signature",
  "stripe_signature",
  "api_key",
  "apikey",
  "authorization",
  "auth",
  "code",
];

function isSensitiveQueryKey(key) {
  const normalized = String(key || "").toLowerCase();

  return SENSITIVE_QUERY_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

function sanitizeUrlForLog(url) {
  if (!url || typeof url !== "string") return url;

  try {
    const parsed = new URL(url, "http://localhost");

    for (const key of parsed.searchParams.keys()) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

module.exports = {
  sanitizeUrlForLog,
  isSensitiveQueryKey,
};