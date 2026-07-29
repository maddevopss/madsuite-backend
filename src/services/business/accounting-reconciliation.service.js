function number(value) {
  return Number(value || 0);
}

function money(value) {
  const normalized = number(value);
  if (!Number.isFinite(normalized)) {
    throw Object.assign(new Error("Montant de rapprochement invalide."), { statusCode: 500 });
  }
  return Number(normalized.toFixed(2));
}

const REMEDIATION = {
  matched: {
    severity: "info",
    action: "none",
    explanation: "Le document métier et son écriture comptable concordent.",
  },
  missing_entry: {
    severity: "error",
    action: "create_adjustment",
    explanation: "Aucune écriture comptable publiée ne correspond à ce document métier.",
  },
  duplicate_entries: {
    severity: "error",
    action: "review_and_reverse",
    explanation: "Plus d’une écriture comptable active est liée au même document métier.",
  },
  unbalanced_entry: {
    severity: "error",
    action: "review_and_reverse",
    explanation: "Les débits et les crédits liés à ce document ne sont pas égaux.",
  },
  amount_mismatch: {
    severity: "warning",
    action: "create_adjustment",
    explanation: "Le montant du document métier diffère du montant comptabilisé.",
  },
  orphan_entry: {
    severity: "warning",
    action: "review_and_reverse",
    explanation: "Cette écriture comptable ne possède plus de preuve métier correspondante.",
  },
};

function remediationFor(status) {
  return REMEDIATION[status] || {
    severity: "warning",
    action: "manual_review",
    explanation: "Cette situation exige une vérification humaine.",
  };
}

function normalizeEntryIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite);
}

function classify(row) {
  const sourceAmount = money(row.source_amount);
  const postedDebit = money(row.posted_debit);
  const postedCredit = money(row.posted_credit);
  const entryCount = number(row.entry_count);
  const difference = money(sourceAmount - postedDebit);

  let status = "matched";
  if (entryCount === 0) status = "missing_entry";
  else if (entryCount > 1) status = "duplicate_entries";
  else if (postedDebit !== postedCredit) status = "unbalanced_entry";
  else if (difference !== 0) status = "amount_mismatch";

  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceAmount,
    postedDebit,
    postedCredit,
    difference,
    entryCount,
    entryIds: normalizeEntryIds(row.entry_ids),
    status,
    remediation: remediationFor(status),
  };
}

function normalizeOrphan(row) {
  return {
    id: Number(row.id),
    entryNumber: row.entry_number,
    entryDate: row.entry_date,
    sourceType: row.source_type,
    sourceId: row.source_id,
    status: "orphan_entry",
    remediation: remediationFor("orphan_entry"),
  };
}

function summarize(rows = [], orphanEntries = []) {
  const documents = rows.map(classify);
  const anomalies = documents.filter((row) => row.status !== "matched");
  const normalizedOrphans = orphanEntries.map(normalizeOrphan);
  const counts = {
    matched: documents.filter((row) => row.status === "matched").length,
    missingEntry: documents.filter((row) => row.status === "missing_entry").length,
    duplicateEntries: documents.filter((row) => row.status === "duplicate_entries").length,
    unbalancedEntry: documents.filter((row) => row.status === "unbalanced_entry").length,
    amountMismatch: documents.filter((row) => row.status === "amount_mismatch").length,
    orphanEntries: normalizedOrphans.length,
  };

  return {
    checked: documents.length,
    balanced: counts.matched,
    anomalies,
    orphanEntries: normalizedOrphans,
    counts,
    healthy: anomalies.length === 0 && normalizedOrphans.length === 0,
    requiresHumanDecision: anomalies.length > 0 || normalizedOrphans.length > 0,
  };
}

async function reconcilePostedSources(db, organisationId) {
  if (!organisationId) {
    throw Object.assign(new Error("organisationId est obligatoire."), { statusCode: 400 });
  }

  const { rows } = await db.query(
    `WITH accounting_entries_normalized AS (
       SELECT
         CASE
           WHEN e.source_type LIKE 'accounting_adjustment_%'
             THEN SUBSTRING(e.source_type FROM LENGTH('accounting_adjustment_') + 1)
           ELSE e.source_type
         END AS source_type,
         e.source_id::text AS source_id,
         e.id,
         e.source_type LIKE 'accounting_adjustment_%' AS is_adjustment,
         COALESCE(SUM(l.debit), 0)::numeric AS debit,
         COALESCE(SUM(l.credit), 0)::numeric AS credit
       FROM accounting_entries e
       JOIN accounting_entry_lines l
         ON l.entry_id = e.id AND l.organisation_id = e.organisation_id
       WHERE e.organisation_id = $1
         AND e.status IN ('posted','reversed')
         AND e.source_type IS NOT NULL
         AND e.source_id IS NOT NULL
       GROUP BY e.source_type, e.source_id, e.id
     ), accounting_totals AS (
       SELECT source_type, source_id,
              COALESCE(SUM(debit), 0)::numeric AS posted_debit,
              COALESCE(SUM(credit), 0)::numeric AS posted_credit,
              CASE
                WHEN COUNT(DISTINCT id) FILTER (WHERE NOT is_adjustment) = 0
                  AND COUNT(DISTINCT id) FILTER (WHERE is_adjustment) > 0 THEN 1
                ELSE COUNT(DISTINCT id) FILTER (WHERE NOT is_adjustment)
              END::integer AS entry_count,
              ARRAY_AGG(DISTINCT id ORDER BY id) AS entry_ids
       FROM accounting_entries_normalized
       GROUP BY source_type, source_id
     ), source_totals AS (
       SELECT le.reference_type AS source_type, le.reference_id::text AS source_id,
              COALESCE(MAX(le.amount), 0)::numeric AS source_amount
       FROM ledger_entries le
       WHERE le.organisation_id = $1
         AND le.reference_type IS NOT NULL
         AND le.reference_id IS NOT NULL
       GROUP BY le.reference_type, le.reference_id::text
     )
     SELECT COALESCE(s.source_type, a.source_type) AS source_type,
            COALESCE(s.source_id, a.source_id) AS source_id,
            COALESCE(s.source_amount, 0)::numeric AS source_amount,
            COALESCE(a.posted_debit, 0)::numeric AS posted_debit,
            COALESCE(a.posted_credit, 0)::numeric AS posted_credit,
            COALESCE(a.entry_count, 0)::integer AS entry_count,
            COALESCE(a.entry_ids, ARRAY[]::bigint[]) AS entry_ids
     FROM source_totals s
     FULL OUTER JOIN accounting_totals a
       ON s.source_type = a.source_type AND s.source_id = a.source_id
     ORDER BY COALESCE(s.source_type, a.source_type), COALESCE(s.source_id, a.source_id)`,
    [organisationId],
  );

  const orphanResult = await db.query(
    `SELECT e.id, e.entry_number, e.entry_date, e.source_type, e.source_id
     FROM accounting_entries e
     LEFT JOIN ledger_entries le
       ON le.organisation_id = e.organisation_id
      AND le.reference_type = e.source_type
      AND le.reference_id::text = e.source_id::text
     WHERE e.organisation_id = $1
       AND e.status IN ('posted','reversed')
       AND e.source_type IS NOT NULL
       AND e.source_id IS NOT NULL
       AND e.source_type NOT LIKE 'accounting_adjustment_%'
       AND le.id IS NULL
     ORDER BY e.entry_date DESC, e.id DESC`,
    [organisationId],
  );

  return summarize(rows, orphanResult.rows);
}

module.exports = {
  REMEDIATION,
  number,
  money,
  remediationFor,
  normalizeEntryIds,
  normalizeOrphan,
  classify,
  summarize,
  reconcilePostedSources,
};
