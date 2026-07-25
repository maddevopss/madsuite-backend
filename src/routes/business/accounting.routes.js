const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const accountingService = require("../../services/business/accounting.service");

router.use(requireOrganisation);

router.get("/accounts", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      "SELECT * FROM accounting_accounts WHERE organisation_id = $1 ORDER BY code",
      [req.organisationId],
    );
    res.json({ accounts: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/accounts", requireRole("admin"), async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO accounting_accounts
       (organisation_id, code, name, account_type, normal_balance, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [req.organisationId, body.code, body.name, body.accountType, body.normalBalance, body.parentId || null],
    );
    res.status(201).json({ account: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/entries", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT e.*, j.code journal_code
       FROM accounting_entries e
       JOIN accounting_journals j ON j.id = e.journal_id
       WHERE e.organisation_id = $1
       ORDER BY entry_date DESC, id DESC
       LIMIT 250`,
      [req.organisationId],
    );
    res.json({ entries: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/entries", requireRole("admin"), async (req, res, next) => {
  try {
    const entry = await accountingService.createEntry(req.db, req.organisationId, req.user?.id, req.body);
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

router.post("/entries/:id/post", requireRole("admin"), async (req, res, next) => {
  try {
    const entry = await accountingService.postEntry(req.db, req.organisationId, Number(req.params.id));
    if (!entry) return res.status(404).json({ message: "Écriture introuvable ou déjà publiée." });
    return res.json({ entry });
  } catch (error) {
    return next(error);
  }
});

router.get("/trial-balance", async (req, res, next) => {
  try {
    const rows = await accountingService.trialBalance(
      req.db,
      req.organisationId,
      req.query.startDate,
      req.query.endDate,
    );
    res.json({ rows });
  } catch (error) {
    next(error);
  }
});

router.get("/statements", async (req, res, next) => {
  try {
    res.json(await accountingService.statements(req.db, req.organisationId, req.query.endDate));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
