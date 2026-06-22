const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

async function recordAiAuditLogs({
  organisationId,
  invoiceId,
  customDescriptions,
  client = db
}) {
  if (!customDescriptions || Object.keys(customDescriptions).length === 0) {
    return;
  }

  const aiLogsValues = [];
  const aiLogsParams = [];
  let aiIdx = 1;
  
  for (const [entryId, desc] of Object.entries(customDescriptions)) {
    if (desc) {
      aiLogsValues.push(`($${aiIdx}, $${aiIdx+1}, $${aiIdx+2}, $${aiIdx+3}, $${aiIdx+4})`);
      aiLogsParams.push(
        organisationValue(organisationId),
        invoiceId,
        "Frontend generated or manual edit",
        desc,
        "manual/frontend"
      );
      aiIdx += 5;
    }
  }
  
  if (aiLogsValues.length > 0) {
    await client.query(
      `INSERT INTO ai_audit_logs (organisation_id, invoice_id, prompt, output, model) VALUES ${aiLogsValues.join(", ")}`,
      aiLogsParams
    );
  }
}

module.exports = {
  recordAiAuditLogs
};
