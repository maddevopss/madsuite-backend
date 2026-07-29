const governanceService = require("./accounting-governance.service");
const { assertOpenAccountingPeriod } = require("./accounting-period-lock.service");

async function createPostedAdjustment(input = {}) {
  if (!input.db || typeof input.db.query !== "function") {
    throw Object.assign(new Error("La connexion active est requise pour vérifier la période comptable."), {
      statusCode: 500,
      code: "accounting_period.db_required",
    });
  }

  await assertOpenAccountingPeriod(input.db, {
    organisationId: input.organisationId,
    entryDate: input.entryDate,
    operation: "accounting.adjustment.post",
  });

  return governanceService.createPostedAdjustment(input);
}

module.exports = {
  ...governanceService,
  createPostedAdjustment,
};
