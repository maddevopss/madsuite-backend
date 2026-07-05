const { sanitizeUrlForLog, isSensitiveQueryKey } = require("../utils/sanitizeLog");

describe("sanitizeUrlForLog", () => {
  test("retourne la valeur telle quelle si elle est vide ou invalide", () => {
    expect(sanitizeUrlForLog(null)).toBe(null);
    expect(sanitizeUrlForLog(undefined)).toBe(undefined);
    expect(sanitizeUrlForLog("")).toBe("");
  });

  test("conserve les paramètres non sensibles", () => {
    expect(sanitizeUrlForLog("/api/test?normal=ok&page=1")).toBe(
      "/api/test?normal=ok&page=1",
    );
  });

  test("masque les tokens sensibles", () => {
    expect(sanitizeUrlForLog("/api/test?token=abc&normal=ok")).toBe(
      "/api/test?token=%5BREDACTED%5D&normal=ok",
    );
  });

  test("masque les codes sensibles", () => {
    expect(sanitizeUrlForLog("/api/oauth/callback?code=xyz&state=ok")).toBe(
      "/api/oauth/callback?code=%5BREDACTED%5D&state=ok",
    );
  });

  test("masque aussi les clés sensibles partielles", () => {
    expect(sanitizeUrlForLog("/api/test?stripe_signature=abc&normal=ok")).toBe(
      "/api/test?stripe_signature=%5BREDACTED%5D&normal=ok",
    );
  });

  test("détecte les clés sensibles", () => {
    expect(isSensitiveQueryKey("stripe_signature")).toBe(true);
    expect(isSensitiveQueryKey("access_token")).toBe(true);
    expect(isSensitiveQueryKey("normal")).toBe(false);
  });
});