const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const accountingService = require("../../services/business/accounting-period-guarded.service");
const accountingLedgerService = require("../../services/business/accounting-ledger.service");
const accountingMasterdataService = require("../../services/business/accounting-masterdata.service");
const accountingGovernanceService = require("../../services/business/accounting-governance-period-guarded.service");
const accountingReversalService = require("../../services/business/accounting-reversal-governance.service");
const accountingExportService = require("../../services/business/accounting-export.service");
const accountingTrialBalanceService = require("../../services/business/accounting-trial-balance.service");
const accountingReconciliationService = require("../../services/business/accounting-reconciliation.service");
const accountingRemediationService = require("../../services/business/accounting-remediation.service");
const accountingFixedAssetsService = require("../../services/business/accounting-fixed-assets.service");
const taxCodesService = require("../../services/business/tax-codes.service");
const businessEventService = require("../../services/business/business-event.service");
const financialProjectionService = require("../../services/business/financial-projection.service");
const accountingStatementsComparativeService = require("../../services/business/accounting-statements-comparative.service");

router.use(requireOrganisation);

router.get("/accounts", async (req, res, next) => {
  try {
    const { rows } = await req.db.query("SELECT * FROM accounting_accounts WHERE organisation_id = $1 ORDER BY code", [req.organisationId]);
    res.json({ accounts: rows });
  } catch (error) { next(error); }
});

router.post("/accounts/seed", requireRole("admin"), async (req, res, next) => {
  try {
    const inserted = await accountingService.seedDefaultChart(req.db, req.organisationId);
    res.status(inserted > 0 ? 201 : 200).json({ inserted });
  } catch (error) { next(error); }
});

router.post("/accounts", requireRole("admin"), async (req, res, next) => {
  try {
    const account = await accountingMasterdataService.createAccount(req.db, req.organisationId, req.body);
    res.status(201).json({ account });
  } catch (error) { next(error); }
});

router.get("/tax-codes", async (req, res, next) => {
  try {
    const taxCodes = await taxCodesService.listTaxCodes(req.db, req.organisationId);
    return res.json({ taxCodes });
  } catch (error) { return next(error); }
});

router.post("/tax-codes", requireRole("admin"), async (req, res, next) => {
  try {
    const taxCode = await taxCodesService.createTaxCode(req.db, req.organisationId, { ...req.body, createdBy: req.user?.id });
    await businessEventService.appendEvent(req.db, {
      organisationId: req.organisationId,
      eventType: "accounting.tax_code.created",
      aggregateType: "tax_code",
      aggregateId: taxCode.id,
      actorUserId: req.user?.id,
      payload: { code: taxCode.code, rate: taxCode.rate, taxType: taxCode.tax_type },
    });
    return res.status(201).json({ taxCode });
  } catch (error) { return next(error); }
});

router.post("/tax-codes/:id/activate", requireRole("admin"), async (req, res, next) => {
  try {
    const taxCode = await taxCodesService.activateTaxCode(req.db, req.organisationId, Number(req.params.id), req.user?.id);
    await businessEventService.appendEvent(req.db, {
      organisationId: req.organisationId,
      eventType: "accounting.tax_code.activated",
      aggregateType: "tax_code",
      aggregateId: taxCode.id,
      actorUserId: req.user?.id,
      payload: { code: taxCode.code, rate: taxCode.rate },
    });
    return res.json({ taxCode });
  } catch (error) { return next(error); }
});

router.get("/tax-codes/resolve", async (req, res, next) => {
  try {
    if (!req.query.code || !req.query.date) return res.status(400).json({ message: "Le code et la date sont obligatoires." });
    const taxCode = await taxCodesService.resolveActiveTaxCode(req.db, req.organisationId, req.query.code, req.query.date);
    if (!taxCode) return res.status(404).json({ message: "Aucun profil de taxe actif pour ce code à cette date." });
    return res.json({ taxCode });
  } catch (error) { return next(error); }
});

router.get("/periods", async (req, res, next) => {
  try {
    const { rows } = await req.db.query("SELECT * FROM accounting_periods WHERE organisation_id = $1 ORDER BY starts_on DESC", [req.organisationId]);
    res.json({ periods: rows });
  } catch (error) { next(error); }
});

router.post("/periods", requireRole("admin"), async (req, res, next) => {
  try {
    const period = await accountingMasterdataService.createPeriod(req.db, req.organisationId, req.body);
    return res.status(201).json({ period });
  } catch (error) { return next(error); }
});

router.post("/periods/:id/close", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingGovernanceService.closePeriod({ periodId: Number(req.params.id), organisationId: req.organisationId, reason: req.body.reason, closedBy: req.user?.id });
    if (!result) return res.status(404).json({ message: "Période comptable introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.patch("/periods/:id/close", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingGovernanceService.closePeriod({ periodId: Number(req.params.id), organisationId: req.organisationId, reason: req.body.reason || "Fermeture administrative de la période", closedBy: req.user?.id });
    if (!result) return res.status(404).json({ message: "Période comptable introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post("/periods/:id/reopen", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingGovernanceService.reopenPeriod({ periodId: Number(req.params.id), organisationId: req.organisationId, reason: req.body.reason, reopenedBy: req.user?.id });
    if (!result) return res.status(404).json({ message: "Période comptable introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.get("/entries", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT e.*, j.code journal_code, p.fiscal_year, p.period_number, p.status AS period_status
       FROM accounting_entries e JOIN accounting_journals j ON j.id=e.journal_id
       LEFT JOIN accounting_periods p ON p.id=e.period_id AND p.organisation_id=e.organisation_id
       WHERE e.organisation_id=$1 ORDER BY entry_date DESC, id DESC LIMIT 250`,
      [req.organisationId],
    );
    res.json({ entries: rows });
  } catch (error) { next(error); }
});

router.get("/entries/:id", async (req, res, next) => {
  try {
    const detail = await accountingMasterdataService.getEntryDetail(req.db, req.organisationId, Number(req.params.id));
    if (!detail) return res.status(404).json({ message: "Écriture comptable introuvable." });
    return res.json(detail);
  } catch (error) { return next(error); }
});

router.post("/entries", requireRole("admin"), async (req, res, next) => {
  try {
    const entry = await accountingService.createEntry(req.db, req.organisationId, req.user?.id, req.body);
    res.status(201).json({ entry });
  } catch (error) { next(error); }
});

router.post("/entries/adjustments", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingGovernanceService.createPostedAdjustment({
      db: req.db,
      organisationId: req.organisationId, userId: req.user?.id, idempotencyKey: req.body.idempotencyKey,
      entryDate: req.body.entryDate, description: req.body.description, reason: req.body.reason, lines: req.body.lines,
      journalCode: req.body.journalCode, journalName: req.body.journalName, adjustmentKind: req.body.adjustmentKind,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post("/entries/:id/post", requireRole("admin"), async (req, res, next) => {
  try {
    const entry = await accountingService.postEntry(req.db, req.organisationId, Number(req.params.id));
    if (!entry) return res.status(404).json({ message: "Écriture introuvable ou déjà publiée." });
    return res.json({ entry });
  } catch (error) { return next(error); }
});

router.post("/entries/:id/reversal/preview", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingReversalService.previewPostedEntryReversal({
      db: req.db,
      organisationId: req.organisationId,
      entryId: Number(req.params.id),
      reversalDate: req.body.reversalDate,
      reason: req.body.reason,
    });
    if (!result) return res.status(404).json({ message: "Écriture publiée introuvable." });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post("/entries/:id/reverse", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingReversalService.reversePostedEntry({
      organisationId: req.organisationId,
      entryId: Number(req.params.id),
      reversalDate: req.body.reversalDate,
      reason: req.body.reason,
      idempotencyKey: req.body.idempotencyKey,
      confirmedByHuman: req.body.confirmedByHuman,
      reversedBy: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Écriture publiée introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.get("/entries/:id/explain", async (req, res, next) => {
  try {
    const explanation = await accountingGovernanceService.explainEntry(req.db, req.organisationId, Number(req.params.id));
    if (!explanation) return res.status(404).json({ message: "Écriture comptable introuvable." });
    return res.json(explanation);
  } catch (error) { return next(error); }
});

router.get("/ledger", async (req, res, next) => {
  try {
    const ledger = await accountingLedgerService.getLedger(req.db, req.organisationId, {
      accountId: req.query.accountId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      sourceType: req.query.sourceType,
      sourceId: req.query.sourceId,
      projectId: req.query.projectId,
      clientId: req.query.clientId,
      supplierId: req.query.supplierId,
    });
    return res.json(ledger);
  } catch (error) { return next(error); }
});

router.get("/trial-balance", async (req, res, next) => {
  try {
    const result = await accountingTrialBalanceService.getComparativeTrialBalance(req.db, req.organisationId, {
      current: { startDate: req.query.startDate, endDate: req.query.endDate },
      previous: { startDate: req.query.previousStartDate, endDate: req.query.previousEndDate },
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.get("/statements", async (req, res, next) => {
  try {
    const result = await accountingStatementsComparativeService.getComparativeStatements(req.db, req.organisationId, {
      current: { startDate: req.query.startDate, endDate: req.query.endDate },
      previous: { startDate: req.query.previousStartDate, endDate: req.query.previousEndDate },
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.get("/statements/explained", async (req, res, next) => {
  try { return res.json(await accountingGovernanceService.explainedStatements(req.db, req.organisationId, req.query.endDate)); }
  catch (error) { return next(error); }
});

router.get("/cash-flow", async (req, res, next) => {
  try { return res.json(await accountingExportService.cashFlow(req.db, req.organisationId, req.query.startDate, req.query.endDate)); }
  catch (error) { return next(error); }
});

router.get("/reconciliation", async (req, res, next) => {
  try { return res.json(await accountingReconciliationService.reconcilePostedSources(req.db, req.organisationId)); }
  catch (error) { return next(error); }
});

router.post("/reconciliation/remediation/preview", requireRole("admin"), async (req, res, next) => {
  try {
    return res.json(await accountingRemediationService.previewControlledAdjustment({ db: req.db, organisationId: req.organisationId, command: req.body }));
  } catch (error) { return next(error); }
});

router.post("/reconciliation/remediation/apply", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingRemediationService.applyControlledAdjustment({ db: req.db, organisationId: req.organisationId, userId: req.user?.id, command: req.body });
    return res.status(result.adjustment?.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.get("/fixed-assets", async (req, res, next) => {
  try {
    const assets = await accountingFixedAssetsService.listFixedAssets(req.db, req.organisationId);
    return res.json({ assets });
  } catch (error) { return next(error); }
});

router.get("/fixed-assets/:id", async (req, res, next) => {
  try {
    const asset = await accountingFixedAssetsService.getFixedAsset(req.db, req.organisationId, Number(req.params.id));
    if (!asset) return res.status(404).json({ message: "Immobilisation introuvable." });
    return res.json({ asset });
  } catch (error) { return next(error); }
});

router.post("/fixed-assets", requireRole("admin"), async (req, res, next) => {
  try {
    const asset = await accountingFixedAssetsService.registerAsset(req.db, req.organisationId, req.body);
    await businessEventService.appendEvent(req.db, {
      organisationId: req.organisationId,
      eventType: "accounting.fixed_asset.registered",
      aggregateType: "accounting_fixed_asset",
      aggregateId: asset.id,
      actorUserId: req.user?.id,
      payload: { assetNumber: asset.asset_number, acquisitionCost: asset.acquisition_cost },
    });
    return res.status(201).json({ asset });
  } catch (error) { return next(error); }
});

router.get("/fixed-assets/depreciation-runs", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM accounting_depreciation_runs WHERE organisation_id=$1 ORDER BY run_date DESC, id DESC`,
      [req.organisationId],
    );
    return res.json({ runs: rows });
  } catch (error) { return next(error); }
});

router.post("/fixed-assets/depreciation-runs", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingFixedAssetsService.runDepreciation(req.db, req.organisationId, {
      runDate: req.body.runDate,
      periodId: req.body.periodId,
      idempotencyKey: req.body.idempotencyKey,
      createdBy: req.user?.id,
    });
    if (!result.duplicate) {
      await businessEventService.appendEvent(req.db, {
        organisationId: req.organisationId,
        eventType: "accounting.fixed_asset.depreciation_posted",
        aggregateType: "accounting_depreciation_run",
        aggregateId: result.run.id,
        actorUserId: req.user?.id,
        payload: { runDate: req.body.runDate, totals: result.totals, entryId: result.entryId },
      });
    }
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.get("/exports/trial-balance.csv", async (req, res, next) => {
  try {
    const csv = await accountingExportService.trialBalanceCsv(req.db, req.organisationId, req.query.startDate, req.query.endDate);
    return res.type("text/csv").set("Content-Disposition", "attachment; filename=balance-verification.csv").send(csv);
  } catch (error) { return next(error); }
});

router.get("/exports/journal.csv", async (req, res, next) => {
  try {
    const csv = await accountingExportService.journalCsv(req.db, req.organisationId, req.query.startDate, req.query.endDate);
    return res.type("text/csv").set("Content-Disposition", "attachment; filename=journal-comptable.csv").send(csv);
  } catch (error) { return next(error); }
});

router.get("/events", async (req, res, next) => {
  try {
    const events = await businessEventService.listEvents(req.db, req.organisationId, { eventType: req.query.eventType, aggregateType: req.query.aggregateType, aggregateId: req.query.aggregateId, limit: req.query.limit });
    return res.json({ events });
  } catch (error) { return next(error); }
});

router.post("/projections/financial-daily/rebuild", requireRole("admin"), async (req, res, next) => {
  try {
    await req.db.query("BEGIN");
    const result = await financialProjectionService.rebuildFinancialDailyProjection(req.db, req.organisationId);
    await req.db.query("COMMIT");
    return res.json(result);
  } catch (error) {
    try { await req.db.query("ROLLBACK"); } catch (_) {}
    return next(error);
  }
});

router.get("/projections/financial-daily", async (req, res, next) => {
  try {
    const rows = await financialProjectionService.listFinancialDailyProjection(req.db, req.organisationId, { startDate: req.query.startDate, endDate: req.query.endDate });
    return res.json({ rows });
  } catch (error) { return next(error); }
});

module.exports = router;