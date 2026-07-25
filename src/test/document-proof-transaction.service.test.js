const { evaluatePolicy } = require("../services/business/transaction-engine.service");
const {
  DOCUMENT_CREATE_POLICY,
  VERSION_ADD_POLICY,
  DOCUMENT_TRANSITION_POLICY,
  ATTESTATION_CREATE_POLICY,
  CUSTODY_EVENT_POLICY,
  checksum,
  validSha256,
} = require("../services/business/document-proof-transaction.service");

describe("document and proof transactional core", () => {
  test("refuse un document sans identité minimale", async () => {
    const decision = await evaluatePolicy({ policy: DOCUMENT_CREATE_POLICY, input: { title: "Contrat" }, idempotencyKey: "document-create-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("documents.identity_required");
  });

  test("produit et reconnaît une empreinte SHA-256", () => {
    const value = checksum("preuve stable");
    expect(validSha256(value)).toBe(true);
    expect(value).toBe(checksum("preuve stable"));
  });

  test("refuse une version sans empreinte valide", async () => {
    const decision = await evaluatePolicy({
      policy: VERSION_ADD_POLICY,
      input: { documentId: 1, version: "1.0", fileName: "preuve.pdf", mimeType: "application/pdf", storageKey: "org/1/preuve.pdf", byteSize: 42, checksumSha256: "invalide", source: "upload" },
      idempotencyKey: "document-version-001",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("documents.checksum_invalid");
  });

  test("accepte une version entièrement traçable", async () => {
    const decision = await evaluatePolicy({
      policy: VERSION_ADD_POLICY,
      input: { documentId: 1, version: "1.0", fileName: "preuve.pdf", mimeType: "application/pdf", storageKey: "org/1/preuve.pdf", byteSize: 42, checksumSha256: checksum("contenu"), source: "upload" },
      idempotencyKey: "document-version-002",
    });
    expect(decision.allowed).toBe(true);
  });

  test("refuse la publication sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: DOCUMENT_TRANSITION_POLICY, input: { documentId: 1, action: "published", evidence: [] }, idempotencyKey: "document-publish-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("documents.transition_evidence_required");
  });

  test("interdit la destruction sous conservation juridique", async () => {
    const decision = await evaluatePolicy({ policy: DOCUMENT_TRANSITION_POLICY, input: { documentId: 1, action: "destroyed", reason: "Fin de rétention", legalHold: true }, idempotencyKey: "document-destroy-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("documents.legal_hold_active");
  });

  test("refuse une attestation sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: ATTESTATION_CREATE_POLICY, input: { documentId: 1, versionId: 2, subjectType: "employee", subjectId: "7", attestationType: "read", evidence: [] }, idempotencyKey: "document-attest-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("documents.attestation_evidence_required");
  });

  test("exige une raison pour un transfert de garde", async () => {
    const decision = await evaluatePolicy({ policy: CUSTODY_EVENT_POLICY, input: { documentId: 1, action: "transferred" }, idempotencyKey: "document-custody-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("documents.custody_reason_required");
  });
});
