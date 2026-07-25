const fs = require("fs");
const path = require("path");

describe("Contrat — rappels de soumission sécurisés", () => {
  test("le worker crée un lien opaque et ne transmet jamais l’ancien UUID", () => {
    const worker = fs.readFileSync(path.join(__dirname, "../jobs/outboxWorker.js"), "utf8");

    expect(worker).toContain("createEstimatePublicLink");
    expect(worker).toContain("secureToken");
    expect(worker).toContain("public_token: secureToken");
    expect(worker).not.toContain("public_token: estimate.public_token");
  });
});
