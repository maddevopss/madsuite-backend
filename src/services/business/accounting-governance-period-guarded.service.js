const governanceService = require("./accounting-governance.service");
const { assertOpenAccountingPeriod } = require("./accounting-period-lock.service");

async function createPostedAdjustment(input) {
  await assertOpenAccountingPeriod(input.db || input.client || require("../../db"), {
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
