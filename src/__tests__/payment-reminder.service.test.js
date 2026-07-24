const {
  nextStage,
  stageType,
  buildPreview,
} = require("../services/payment-reminder.service");

describe("payment reminder service", () => {
  test.each([
    [0, [], null],
    [2, [], null],
    [3, [], 3],
    [6, [3], null],
    [7, [3], 7],
    [14, [3, 7], 14],
    [30, [3, 7, 14], null],
  ])("nextStage(%s, %j) => %s", (days, completed, expected) => {
    expect(nextStage(days, completed)).toBe(expected);
  });

  test("associe les étapes aux modèles déterministes", () => {
    expect(stageType(3)).toBe("gentle");
    expect(stageType(7)).toBe("firm");
    expect(stageType(14)).toBe("final");
    expect(() => stageType(5)).toThrow("Étape de relance invalide");
  });

  test("construit un aperçu depuis les données canoniques de la facture", () => {
    const preview = buildPreview(
      {
        invoice_number: "FAC-00042",
        total: "345.00",
        due_date: "2026-07-01",
        client_email: "client@example.com",
      },
      7,
      "https://madsuite.ca/portal/secure-token",
    );

    expect(preview).toEqual(expect.objectContaining({
      stage: 7,
      type: "firm",
      recipient: "client@example.com",
      subject: expect.stringContaining("FAC-00042"),
      message: expect.stringContaining("345.00 $ CA"),
      portal_url: "https://madsuite.ca/portal/secure-token",
    }));
  });
});
