const express = require("express");
const { exportInvoicesToCSV, exportExpensesToCSV, exportLedgerToCSV } = require("./export.service");
const { requireOrganisation } = require("../../middleware/organization.middleware");
const { getOrganisationId } = require("../../utils/organisationScope");
const { recordBusinessAudit } = require("../../services/auditLog.service");

const router = express.Router();
router.use(requireOrganisation);

/**
 * Helper to wrap async route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function setCSVHeaders(res, filename) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}

function parseExportDateRange(req) {
  const { startDate, endDate } = req.query;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (startDate && !datePattern.test(String(startDate))) {
    const err = new Error("startDate invalide. Format attendu: YYYY-MM-DD.");
    err.statusCode = 400;
    throw err;
  }

  if (endDate && !datePattern.test(String(endDate))) {
    const err = new Error("endDate invalide. Format attendu: YYYY-MM-DD.");
    err.statusCode = 400;
    throw err;
  }

  if (startDate && endDate && String(startDate) > String(endDate)) {
    const err = new Error("startDate doit être avant ou égale à endDate.");
    err.statusCode = 400;
    throw err;
  }

  return {
    startDate: startDate ? String(startDate) : undefined,
    endDate: endDate ? String(endDate) : undefined,
  };
}

async function auditExport(req, organisationId, exportType, range) {
  await recordBusinessAudit({
    organisationId,
    actorUserId: req.user?.id,
    action: `export.${exportType}.csv`,
    entityType: "export",
    entityId: null,
    details: {
      exportType,
      startDate: range.startDate || null,
      endDate: range.endDate || null,
    },
    req,
  });
}

router.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const organisationId = getOrganisationId(req);
    const range = parseExportDateRange(req);

    const csvData = await exportInvoicesToCSV(organisationId, range);
    await auditExport(req, organisationId, "invoices", range);

    setCSVHeaders(res, `invoices_${organisationId}_${new Date().toISOString().slice(0, 10)}.csv`);
    // Add BOM for Excel compatibility
    res.write('\ufeff');
    res.end(csvData);
  })
);

router.get(
  "/expenses",
  asyncHandler(async (req, res) => {
    const organisationId = getOrganisationId(req);
    const range = parseExportDateRange(req);

    const csvData = await exportExpensesToCSV(organisationId, range);
    await auditExport(req, organisationId, "expenses", range);

    setCSVHeaders(res, `expenses_${organisationId}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.write('\ufeff');
    res.end(csvData);
  })
);

router.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    const organisationId = getOrganisationId(req);
    const range = parseExportDateRange(req);

    const csvData = await exportLedgerToCSV(organisationId, range);
    await auditExport(req, organisationId, "ledger", range);

    setCSVHeaders(res, `ledger_${organisationId}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.write('\ufeff');
    res.end(csvData);
  })
);

module.exports = router;
