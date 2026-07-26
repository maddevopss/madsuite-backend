async function scalar(db, sql, organisationId) {
  return Number((await db.query(sql, [organisationId])).rows[0]?.value || 0);
}

async function buildInstitutionalSummary(db, organisationId) {
  const [
    openRisks,
    criticalRisks,
    activeContinuityPlans,
    overdueAuditFindings,
    overdueAuditActions,
    objectivesAtRisk,
    overdueImprovementPlans,
    receivables,
    payables,
  ] = await Promise.all([
    scalar(db, "SELECT COUNT(*) value FROM enterprise_risks WHERE organisation_id=$1 AND status NOT IN ('closed','accepted','cancelled')", organisationId),
    scalar(db, "SELECT COUNT(*) value FROM enterprise_risks WHERE organisation_id=$1 AND status NOT IN ('closed','accepted','cancelled') AND (inherent_level='critical' OR residual_level='critical')", organisationId),
    scalar(db, "SELECT COUNT(*) value FROM enterprise_continuity_plans WHERE organisation_id=$1 AND status IN ('active','approved','testing')", organisationId),
    scalar(db, "SELECT COUNT(*) value FROM internal_audit_findings WHERE organisation_id=$1 AND due_at<CURRENT_DATE AND status NOT IN ('closed','cancelled')", organisationId),
    scalar(db, "SELECT COUNT(*) value FROM internal_audit_actions WHERE organisation_id=$1 AND due_at<CURRENT_DATE AND status NOT IN ('closed','cancelled')", organisationId),
    scalar(db, "SELECT COUNT(*) value FROM performance_objectives WHERE organisation_id=$1 AND status='at_risk'", organisationId),
    scalar(db, "SELECT COUNT(*) value FROM performance_improvement_plans WHERE organisation_id=$1 AND due_at<CURRENT_DATE AND status NOT IN ('verified','closed','cancelled')", organisationId),
    scalar(db, "SELECT COALESCE(SUM(total),0) value FROM invoices WHERE organisation_id=$1 AND status NOT IN ('paid','cancelled')", organisationId),
    scalar(db, "SELECT COALESCE(SUM(total),0) value FROM supplier_bills WHERE organisation_id=$1 AND status NOT IN ('paid','void')", organisationId),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    contract: 'institutional-summary@1',
    risks: { open: openRisks, critical: criticalRisks },
    continuity: { activePlans: activeContinuityPlans },
    audit: { overdueFindings: overdueAuditFindings, overdueActions: overdueAuditActions },
    performance: { objectivesAtRisk, overdueImprovementPlans },
    finance: { receivables, payables, netExposure: receivables - payables },
  };
}

module.exports = { scalar, buildInstitutionalSummary };
