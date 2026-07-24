const {
  MAX_RECEIPT_SIZE,
  sanitizeFilename,
  validateReceipt,
} = require("../services/expenseReceipts.service");

describe("expenseReceipts.service", () => {
  test("accepte un PDF valide et normalise le nom encodé", () => {
    const result = validateReceipt({
      content: Buffer.from("%PDF-1.4"),
      mimeType: "application/pdf",
      filename: encodeURIComponent("reçu fournisseur.pdf"),
    });

    expect(result).toEqual({
      filename: "reçu fournisseur.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
    });
  });

  test("refuse un format non permis", () => {
    expect(() => validateReceipt({
      content: Buffer.from("texte"),
      mimeType: "text/plain",
      filename: "preuve.txt",
    })).toThrow("Format de preuve d'achat non permis.");
  });

  test("refuse un fichier vide", () => {
    expect(() => validateReceipt({
      content: Buffer.alloc(0),
      mimeType: "image/png",
      filename: "preuve.png",
    })).toThrow("La preuve d'achat est vide.");
  });

  test("refuse un fichier dépassant 5 Mo", () => {
    expect(() => validateReceipt({
      content: Buffer.alloc(MAX_RECEIPT_SIZE + 1),
      mimeType: "image/jpeg",
      filename: "preuve.jpg",
    })).toThrow("La preuve d'achat dépasse la limite de 5 Mo.");
  });

  test("retire les chemins et retours de ligne du nom", () => {
    expect(sanitizeFilename("../dossier\\preuve\r\n.png")).toBe("..-dossier-preuve.png");
  });
});
