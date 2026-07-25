const crypto = require("crypto");
const { registerPolicy } = require("./transaction-engine.service");

const DOCUMENT_CREATE_POLICY = "documents.record.create@1";
const VERSION_ADD_POLICY = "documents.version.add@1";
const DOCUMENT_TRANSITION_POLICY = "documents.record.transition@1";
const ATTESTATION_CREATE_POLICY = "documents.attestation.create@1";
const CUSTODY_EVENT_POLICY = "documents.custody.record@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function checksum(value) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

function hasEvidence(value) {
  return Array.isArray(value) && value.length > 0;
}

registerPolicy("documents.record.create", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "documents.idempotency_invalid" };
  if (!input?.documentNumber || !input?.title || !input?.documentType) return { allowed: false, statusCode: 400, code: "documents.identity_required", reason: "Un document exige un numéro, un titre et un type." };
  return { allowed: true, code: "documents.record.valid" };
});

registerPolicy("documents.version.add", "1", ({ input, idempotencyKey }) => {
  if (!input?.documentId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "documents.version_invalid" };
  if (!input?.version || !input?.fileName || !input?.mimeType || !input?.storageKey || !input?.source) return { allowed: false, statusCode: 400, code: "documents.version_metadata_required" };
  if (!validSha256(input.checksumSha256)) return { allowed: false, statusCode: 400, code: "documents.checksum_invalid", reason: "Une empreinte SHA-256 valide est obligatoire." };
  if (!Number.isInteger(input.byteSize) || input.byteSize < 0) return { allowed: false, statusCode: 400, code: "documents.byte_size_invalid" };
  return { allowed: true, code: "documents.version.valid" };
});

registerPolicy("documents.record.transition", "1", ({ input, idempotencyKey }) => {
  if (!input?.documentId || !input?.action || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "documents.transition_invalid" };
  if (["approved", "published", "archived"].includes(input.action) && !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: "documents.transition_evidence_required", reason: "Cette transition exige une preuve." };
  if (["withdrawn", "destroyed"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "documents.reason_required" };
  if (input.action === "destroyed" && input.legalHold) return { allowed: false, statusCode: 409, code: "documents.legal_hold_active", reason: "Un document sous conservation juridique ne peut pas être détruit." };
  return { allowed: true };
});

registerPolicy("documents.attestation.create", "1", ({ input, idempotencyKey }) => {
  if (!input?.documentId || !input?.versionId || !input?.subjectType || !input?.subjectId || !input?.attestationType || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "documents.attestation_incomplete" };
  if (!hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: "documents.attestation_evidence_required" };
  return { allowed: true };
});

registerPolicy("documents.custody.record", "1", ({ input, idempotencyKey }) => {
  if (!input?.documentId || !input?.action || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "documents.custody_incomplete" };
  if (["exported", "transferred", "destroyed"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "documents.custody_reason_required" };
  return { allowed: true };
});

module.exports = {
  DOCUMENT_CREATE_POLICY,
  VERSION_ADD_POLICY,
  DOCUMENT_TRANSITION_POLICY,
  ATTESTATION_CREATE_POLICY,
  CUSTODY_EVENT_POLICY,
  validIdempotency,
  validSha256,
  checksum,
  hasEvidence,
};
