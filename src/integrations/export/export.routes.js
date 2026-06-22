const express = require("express");
const { exportInvoicesToCSV, exportExpensesToCSV, exportLedgerToCSV } = require("./export.service");

const router = express.Router();

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

router.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const organisationId = req.user.organisation_id;
    const { startDate, endDate } = req.query;

    const csvData = await exportInvoicesToCSV(organisationId, { startDate, endDate });

    setCSVHeaders(res, `invoices_${organisationId}_${new Date().toISOString().slice(0, 10)}.csv`);
    // Add BOM for Excel compatibility
    res.write('\ufeff');
    res.end(csvData);
  })
);

router.get(
  "/expenses",
  asyncHandler(async (req, res) => {
    const organisationId = req.user.organisation_id;
    const { startDate, endDate } = req.query;

    const csvData = await exportExpensesToCSV(organisationId, { startDate, endDate });

    setCSVHeaders(res, `expenses_${organisationId}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.write('\ufeff');
    res.end(csvData);
  })
);

router.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    const organisationId = req.user.organisation_id;
    const { startDate, endDate } = req.query;

    const csvData = await exportLedgerToCSV(organisationId, { startDate, endDate });

    setCSVHeaders(res, `ledger_${organisationId}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.write('\ufeff');
    res.end(csvData);
  })
);

module.exports = router;
