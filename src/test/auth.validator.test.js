const { loginSchema } = require("../validators/auth.validator");

describe("auth.validator", () => {
  test("rejette un email invalide", () => {
    const result = loginSchema.safeParse({ email: "pas-un-email", password: "123" });

    expect(result.success).toBe(false);
  });

  test("accepte des identifiants valides", () => {
    const result = loginSchema.safeParse({ email: "test@chrono.mad", password: "secure" });

    expect(result.success).toBe(true);
  });

  test("rejette un mot de passe vide", () => {
    const result = loginSchema.safeParse({ email: "test@chrono.mad", password: "" });

    expect(result.success).toBe(false);
  });
});
