const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const accountingService = require("../../services/business/accounting.service");
const accountingLedgerService = require("../../services/business/accounting-ledger.service");
const accountingMasterdataService = require("../../services/business/accounting-masterdata.service");
const accountingGovernanceService = require("../../services/business/accounting-governance.service");
const accountingReversalService = require("../../services/business/accounting-reversal-governance.service");
const accountingExportService = require("../../services/business/accounting-export.service");
const accountingTrialBalanceService = require("../../services/business/accounting-trial-balance.service");
const businessEventService = require("../../services/business/business-event.service");
const financialProjectionService = require("../../services/business/financial-projection.service");

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

router.post("/entries/:id/reverse", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingReversalService.reversePostedEntry({
      organisationId: req.organisationId,
      entryId: Number(req.params.id),
      reversalDate: req.body.reversalDate,
      reason: req.body.reason,
      idempotencyKey: req.body.idempotencyKey,
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
      current: {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      },
      previous: {
        startDate: req.query.previousStartDate,
        endDate: req.query.previousEndDate,
      },
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.get("/statements", async (req, res, next) => {
  try { res.json(await accountingService.statements(req.db, req.organisationId, req.query.endDate)); }
  catch (error) { next(error); }
});

router.get("/statements/explained", async (req, res, next) => {
  try { return res.json(await accountingGovernanceService.explainedStatements(req.db, req.organisationId, req.query.endDate)); }
  catch (error) { return next(error); }
});

router.get("/cash-flow", async (req, res, next) => {
  try {
    return res.json(await accountingExportService.cashFlow(req.db, req.organisationId, req.query.startDate, req.query.endDate));
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
