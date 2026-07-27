const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const {
  activateRuleset,
  createRunFromPeriod,
} = require("../../services/business/payroll-run-lifecycle.service");

router.use(requireOrganisation);
router.use(requireRole("admin"));

router.post("/rulesets/:id/activate", async (req, res, next) => {
  try {
    const rulesetId = Number(req.params.id);
    if (!Number.isInteger(rulesetId) || rulesetId <= 0) {
      return res.status(400).json({ message: "Jeu de règles invalide." });
    }
    const ruleset = await activateRuleset(req.db, req.organisationId, rulesetId, req.user?.id);
    return res.json({ ruleset });
  } catch (error) {
    return next(error);
  }
});

router.post("/periods/:id/runs", async (req, res, next) => {
  try {
    const periodId = Number(req.params.id);
    if (!Number.isInteger(periodId) || periodId <= 0) {
      return res.status(400).json({ message: "Période invalide." });
    }
    const result = await createRunFromPeriod(req.db, {
      organisationId: req.organisationId,
      periodId,
      idempotencyKey: req.body?.idempotencyKey,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
