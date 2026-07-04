const { sanitizeUrlForLog } = require("../utils/sanitizeLog");

describe("sanitizeUrlForLog", () => {
  test("masque les query params sensibles", () => {
    const url = "/api/portal?token=abc123&client_id=42&refresh_token=def456&code=xyz";

    expect(sanitizeUrlForLog(url)).toBe(
      "/api/portal?token=%5BREDACTED%5D&client_id=42&refresh_token=%5BREDACTED%5D&code=%5BREDACTED%5D",
    );
  });

  test("garde les URLs sans secrets inchangées", () => {
    expect(sanitizeUrlForLog("/api/clients?page=2&limit=10")).toBe("/api/clients?page=2&limit=10");
  });

  test("masque aussi les clés sensibles partielles", () => {
    expect(sanitizeUrlForLog("/api/test?stripe_signature=abc&normal=ok")).toBe(
      "/api/test?stripe_signature=%5BREDACTED%5D&normal=ok",
    );
  });
});
