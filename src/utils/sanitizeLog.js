const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "auth",
  "authorization",
  "bearer",
  "code",
  "cookie",
  "key",
  "password",
  "refresh",
  "refresh_token",
  "secret",
  "signature",
  "token",
]);

function isSensitiveKey(key) {
  const normalized = String(key || "").toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized) || normalized.includes("token") || normalized.includes("secret") || normalized.includes("password");
}

function sanitizeUrlForLog(value) {
  if (!value || typeof value !== "string") return value;

  try {
    const parsed = new URL(value, "http://madsuite.local");

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }

    const query = parsed.searchParams.toString();
    return `${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return value.replace(/([?&][^=]*(?:token|secret|password|key|code|signature)[^=]*=)[^&\s]+/gi, "$1[REDACTED]");
  }
}

module.exports = {
  isSensitiveKey,
  sanitizeUrlForLog,
};
