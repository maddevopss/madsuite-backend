const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/procurement.routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/099_procurement_finance_links.sql'), 'utf8');

describe('procurement finance integration contract', () => {
  test('exposes transactional finance links', () => {
    expect(route).toContain("router.get('/finance-links'");
    expect(route).toContain("router.post('/finance-links'");
    expect(route).toContain("type: 'procurement.finance_link.create'");
    expect(route).toContain('FOR UPDATE');
  });

  test('validates tenant ownership for every source and target', () => {
    expect(route).toContain('WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
    expect(route).toContain("['suppliers', req.body.supplierId]");
    expect(route).toContain("['supplier_bills', req.body.supplierBillId]");
    expect(route).toContain("['financial_budgets', req.body.budgetId]");
  });

  test('stores references rather than copied financial data', () => {
    expect(migration).toContain('purchase_order_id BIGINT REFERENCES procurement_purchase_orders(id)');
    expect(migration).toContain('budget_id BIGINT REFERENCES financial_budgets(id)');
    expect(migration).not.toMatch(/subtotal|taxes|total NUMERIC|supplier_name/);
    expect(migration).toContain('UNIQUE (organisation_id, idempotency_key)');
  });
});
