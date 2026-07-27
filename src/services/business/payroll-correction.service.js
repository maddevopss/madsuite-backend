function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function validatePaymentTransition(run, idempotencyKey) {
  if (!run) throw conflict("Cycle de paie introuvable.");
  if (run.status !== "approved") throw conflict("Seul un cycle approuvé peut être payé.");
  if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
    throw conflict("Une clé d’idempotence valide est obligatoire.");
  }
  return true;
}

function buildPaidRunCorrection({ originalRun, correctionRunId, reason }) {
  if (!originalRun || originalRun.status !== "paid") {
    throw conflict("Seul un cycle payé peut être corrigé par renversement.");
  }
  if (!reason || !String(reason).trim()) throw conflict("La raison de correction est obligatoire.");
  return {
    sourceType: "payroll_run",
    sourceId: originalRun.id,
    correctionRunId,
    reason: String(reason).trim(),
    reversalIdempotencyKey: `payroll-reversal-${originalRun.id}-${correctionRunId}`,
  };
}

module.exports = { validatePaymentTransition, buildPaidRunCorrection };
