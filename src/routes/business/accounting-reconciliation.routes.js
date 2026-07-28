const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const accountingReconciliationService = require("../../services/business/accounting-reconciliation.service");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const result = await accountingReconciliationService.reconcilePostedSources(
      req.db,
      req.organisationId,
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
