const reconciliationService = require("./accounting-reconciliation.service");
const governanceService = require("./accounting-governance.service");
const accountingService = require("./accounting.service");

function validationError(message, code) {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function conflictError(message, code, details) {
  return Object.assign(new Error(message), { statusCode: 409, code, details });
}

function normalizeSource(value) {
  const sourceType = String(value?.sourceType || "").trim();
  const sourceId = String(value?.sourceId || "").trim();
  if (!sourceType || !sourceId) {
    throw validationError("Le type et l’identifiant de la source sont obligatoires.", "ACCOUNTING_REMEDIATION_SOURCE_REQUIRED");
  }
  if (!/^[a-z0-9_:-]+$/i.test(sourceType)) {
    throw validationError("Le type de source contient des caractères invalides.", "ACCOUNTING_REMEDIATION_SOURCE_INVALID");
  }
  return { sourceType, sourceId };
}

function findAnomaly(snapshot, source) {
  return (snapshot?.anomalies || []).find((item) => (
    item.sourceType === source.sourceType && String(item.sourceId) === source.sourceId
  )) || null;
}

function validatePreviewCommand(command = {}) {
  const source = normalizeSource(command);
  if (!command.entryDate || !Array.isArray(command.lines) || command.lines.length < 2) {
    throw validationError("La date et au moins deux lignes comptables sont obligatoires.", "ACCOUNTING_REMEDIATION_LINES_REQUIRED");
  }

  const validatedEntry = accountingService.validateEntryLines(command.lines);
  return {
    ...source,
    entryDate: command.entryDate,
    description: String(command.description || `Correction de ${source.sourceType} ${source.sourceId}`).trim(),
    lines: validatedEntry.lines,
    totals: {
      debit: validatedEntry.debit,
      credit: validatedEntry.credit,
    },
  };
}

function validateCommand(command = {}) {
  const preview = validatePreviewCommand(command);
  if (command.confirmedByHuman !== true) {
    throw validationError("Une confirmation humaine explicite est obligatoire.", "ACCOUNTING_REMEDIATION_CONFIRMATION_REQUIRED");
  }
  if (String(command.reason || "").trim().length < 10) {
    throw validationError("La justification doit contenir au moins 10 caractères.", "ACCOUNTING_REMEDIATION_REASON_REQUIRED");
  }
  if (String(command.idempotencyKey || "").trim().length < 8) {
    throw validationError("Une clé d’idempotence valide est obligatoire.", "ACCOUNTING_REMEDIATION_IDEMPOTENCY_REQUIRED");
  }
  return {
    ...preview,
    reason: String(command.reason).trim(),
    idempotencyKey: String(command.idempotencyKey).trim(),
  };
}

async function loadCurrentAdjustableAnomaly({ db, organisationId, source }) {
  const reconciliation = await reconciliationService.reconcilePostedSources(db, organisationId);
  const anomaly = findAnomaly(reconciliation, source);
  if (!anomaly) {
    throw conflictError(
      "L’anomalie n’existe plus. Rechargez le rapprochement avant de poursuivre.",
      "ACCOUNTING_REMEDIATION_STALE",
      { sourceType: source.sourceType, sourceId: source.sourceId },
    );
  }
  if (anomaly.remediation?.action !== "create_adjustment") {
    throw conflictError(
      "Cette anomalie ne peut pas être corrigée par une écriture d’ajustement.",
      "ACCOUNTING_REMEDIATION_ACTION_NOT_ALLOWED",
      { status: anomaly.status, recommendedAction: anomaly.remediation?.action || null },
    );
  }
  return { reconciliation, anomaly };
}

async function previewControlledAdjustment({ db, organisationId, command }) {
  const validated = validatePreviewCommand(command);
  const current = await loadCurrentAdjustableAnomaly({ db, organisationId, source: validated });
  return {
    mode: "preview",
    mutatesAccounting: false,
    requiresHumanConfirmation: true,
    source: { sourceType: validated.sourceType, sourceId: validated.sourceId },
    anomaly: current.anomaly,
    proposedEntry: {
      entryDate: validated.entryDate,
      description: validated.description,
      journalCode: "AJU",
      journalName: "Journal des ajustements",
      adjustmentKind: `reconciliation_${current.anomaly.status}`,
      lines: validated.lines,
      totals: validated.totals,
    },
  };
}

function adjustmentEntryId(adjustment) {
  return adjustment?.entry?.id || adjustment?.entryId || null;
}

async function linkAdjustmentToSource({ db, organisationId, adjustment, source }) {
  const entryId = adjustmentEntryId(adjustment);
  if (!entryId) {
    throw conflictError(
      "L’écriture d’ajustement a été créée sans identifiant exploitable.",
      "ACCOUNTING_REMEDIATION_ENTRY_ID_MISSING",
    );
  }
  const linked = await db.query(
    `UPDATE accounting_entries
     SET source_type = $1, source_id = $2
     WHERE organisation_id = $3 AND id = $4
     RETURNING id, source_type, source_id`,
    [`accounting_adjustment_${source.sourceType}`, source.sourceId, organisationId, entryId],
  );
  if (!linked.rowCount) {
    throw conflictError(
      "Impossible de rattacher l’ajustement à la source corrigée.",
      "ACCOUNTING_REMEDIATION_LINK_FAILED",
      { entryId, sourceType: source.sourceType, sourceId: source.sourceId },
    );
  }
  return linked.rows[0];
}

async function applyControlledAdjustment({ db, organisationId, userId, command }) {
  const validated = validateCommand(command);
  const beforeSnapshot = await loadCurrentAdjustableAnomaly({ db, organisationId, source: validated });
  const anomaly = beforeSnapshot.anomaly;

  const adjustment = await governanceService.createPostedAdjustment({
    organisationId,
    userId,
    idempotencyKey: validated.idempotencyKey,
    entryDate: validated.entryDate,
    description: validated.description,
    reason: validated.reason,
    lines: validated.lines,
    journalCode: "AJU",
    journalName: "Journal des ajustements",
    adjustmentKind: `reconciliation_${anomaly.status}`,
  });

  const link = await linkAdjustmentToSource({
    db,
    organisationId,
    adjustment,
    source: validated,
  });

  const after = await reconciliationService.reconcilePostedSources(db, organisationId);
  const remainingAnomaly = findAnomaly(after, validated);
  return {
    source: { sourceType: validated.sourceType, sourceId: validated.sourceId },
    confirmedByHuman: true,
    reason: validated.reason,
    before: anomaly,
    adjustment,
    link,
    after: remainingAnomaly,
    resolved: !remainingAnomaly,
    reconciliation: after,
    proof: {
      actorUserId: userId || null,
      idempotencyKey: validated.idempotencyKey,
      beforeStatus: anomaly.status,
      afterStatus: remainingAnomaly?.status || "resolved",
      entryId: adjustmentEntryId(adjustment),
      linkedSourceType: link.source_type,
      linkedSourceId: link.source_id,
    },
  };
}

module.exports = {
  normalizeSource,
  findAnomaly,
  validatePreviewCommand,
  validateCommand,
  loadCurrentAdjustableAnomaly,
  previewControlledAdjustment,
  adjustmentEntryId,
  linkAdjustmentToSource,
  applyControlledAdjustment,
};
