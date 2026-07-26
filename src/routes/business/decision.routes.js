const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const { buildInstitutionalSummary } = require("../../services/business/institutional-summary.service");

router.use(requireOrganisation);

router.get("/summary", async (req, res, next) => {
  try {
    const scalar = async (sql) => Number((await req.db.query(sql, [req.organisationId])).rows[0]?.value || 0);
    const [receivables, payables, inventoryValue, revenue, expenses, lowStock] = await Promise.all([
      scalar("SELECT COALESCE(SUM(total),0) value FROM invoices WHERE organisation_id=$1 AND status NOT IN ('paid','cancelled')"),
      scalar("SELECT COALESCE(SUM(total),0) value FROM supplier_bills WHERE organisation_id=$1 AND status NOT IN ('paid','void')"),
      scalar(`SELECT COALESCE(SUM(stock.qty * i.cost),0) value
              FROM inventory_items i
              JOIN (SELECT item_id, SUM(quantity) qty FROM inventory_movements WHERE organisation_id=$1 GROUP BY item_id) stock
                ON stock.item_id=i.id
              WHERE i.organisation_id=$1`),
      scalar(`SELECT COALESCE(SUM(l.credit-l.debit),0) value
              FROM accounting_entry_lines l
              JOIN accounting_entries e ON e.id=l.entry_id
              JOIN accounting_accounts a ON a.id=l.account_id
              WHERE l.organisation_id=$1 AND e.status='posted' AND a.account_type='revenue'`),
      scalar(`SELECT COALESCE(SUM(l.debit-l.credit),0) value
              FROM accounting_entry_lines l
              JOIN accounting_entries e ON e.id=l.entry_id
              JOIN accounting_accounts a ON a.id=l.account_id
              WHERE l.organisation_id=$1 AND e.status='posted' AND a.account_type='expense'`),
      scalar(`SELECT COUNT(*) value FROM (
                SELECT i.id, i.reorder_point, COALESCE(SUM(m.quantity),0) quantity
                FROM inventory_items i
                LEFT JOIN inventory_movements m ON m.item_id=i.id
                WHERE i.organisation_id=$1
                GROUP BY i.id
                HAVING COALESCE(SUM(m.quantity),0) <= i.reorder_point
              ) low_stock`),
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      cashPressure: { receivables, payables },
      operations: { inventoryValue, lowStock },
      profitability: { revenue, expenses, netIncome: revenue - expenses },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/institutional-summary", async (req, res, next) => {
  try {
    res.json(await buildInstitutionalSummary(req.db, req.organisationId));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
