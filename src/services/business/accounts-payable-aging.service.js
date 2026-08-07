const BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"];

function bucketFor(daysPastDue) {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1_30";
  if (daysPastDue <= 60) return "31_60";
  if (daysPastDue <= 90) return "61_90";
  return "over_90";
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toUtcDateOnly(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("La date de référence (asOf) est invalide."), { statusCode: 400 });
  }
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function normalizeAsOf(value) {
  return toUtcDateOnly(value || new Date());
}

// Solde impayé par facture fournisseur, calculé à la volée (aucune table de
// matérialisation) à partir des mêmes sources que GET /suppliers/bills :
// paiements actifs et notes de crédit déjà émises. Seules les factures
// comptabilisées (approved/partially_paid/paid) constituent un passif réel ;
// un brouillon n'a pas encore d'écriture comptable et une facture annulée
// n'a plus de solde.
async function loadOutstandingBills(db, organisationId, supplierId) {
  const { rows } = await db.query(
    `SELECT b.id, b.bill_number, b.due_date, b.total, b.status,
            b.supplier_id, s.name AS supplier_name,
            COALESCE((SELECT SUM(p.amount) FROM supplier_payments p
                      WHERE p.supplier_bill_id = b.id AND p.organisation_id = b.organisation_id
                        AND p.reversed_at IS NULL), 0) AS paid_total,
            COALESCE((SELECT SUM(c.total) FROM supplier_credit_notes c
                      WHERE c.supplier_bill_id = b.id AND c.organisation_id = b.organisation_id), 0) AS credited_total
     FROM supplier_bills b
     JOIN suppliers s ON s.id = b.supplier_id
     WHERE b.organisation_id = $1
       AND b.status IN ('approved', 'partially_paid', 'paid')
       AND ($2::bigint IS NULL OR b.supplier_id = $2::bigint)
     ORDER BY b.due_date, b.id`,
    [organisationId, supplierId || null],
  );
  return rows;
}

function emptyTotals() {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
}

async function computeAccountsPayableAging(db, organisationId, { asOf, supplierId } = {}) {
  const referenceDate = normalizeAsOf(asOf);
  const bills = await loadOutstandingBills(db, organisationId, supplierId);

  const totals = emptyTotals();
  const bySupplierMap = new Map();
  const rows = [];

  for (const bill of bills) {
    const balanceDue = money(Math.max(0, Number(bill.total) - Number(bill.paid_total) - Number(bill.credited_total)));
    if (balanceDue <= 0) continue;

    const dueDate = toUtcDateOnly(bill.due_date);
    const daysPastDue = Math.floor((referenceDate - dueDate) / 86400000);
    const bucket = bucketFor(daysPastDue);

    totals[bucket] = money(totals[bucket] + balanceDue);

    if (!bySupplierMap.has(bill.supplier_id)) {
      bySupplierMap.set(bill.supplier_id, {
        supplierId: bill.supplier_id,
        supplierName: bill.supplier_name,
        totals: emptyTotals(),
        totalDue: 0,
      });
    }
    const supplierEntry = bySupplierMap.get(bill.supplier_id);
    supplierEntry.totals[bucket] = money(supplierEntry.totals[bucket] + balanceDue);
    supplierEntry.totalDue = money(supplierEntry.totalDue + balanceDue);

    rows.push({
      billId: bill.id,
      billNumber: bill.bill_number,
      supplierId: bill.supplier_id,
      supplierName: bill.supplier_name,
      dueDate: bill.due_date,
      status: bill.status,
      total: money(bill.total),
      balanceDue,
      daysPastDue,
      bucket,
    });
  }

  const totalDue = money(Object.values(totals).reduce((sum, value) => sum + value, 0));

  return {
    asOf: referenceDate.toISOString().slice(0, 10),
    buckets: BUCKETS,
    totals,
    totalDue,
    bySupplier: Array.from(bySupplierMap.values()).sort((a, b) => b.totalDue - a.totalDue),
    rows,
  };
}

module.exports = { BUCKETS, bucketFor, computeAccountsPayableAging };
