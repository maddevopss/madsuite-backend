function evaluateDecisionDashboardClosure(input = {}) {
  const checks = [];
  const push = (code, ok, details = {}) => checks.push({ code, status: ok ? 'pass' : 'fail', details });

  push('financial_health_present', Boolean(input.financialHealth && Object.keys(input.financialHealth).length));
  push('cashflow_outlook_present', Boolean(input.cashflowOutlook && Object.keys(input.cashflowOutlook).length));
  push('operational_scorecard_present', Boolean(input.operationalScorecard && Object.keys(input.operationalScorecard).length));
  push('risk_summary_present', Boolean(input.riskSummary && Object.keys(input.riskSummary).length));
  push('alerts_resolved', Number(input.unresolvedAlerts || 0) === 0, { unresolvedAlerts: Number(input.unresolvedAlerts || 0) });
  push('evidence_present', Array.isArray(input.evidence) && input.evidence.length > 0);
  push('human_approval_present', Boolean(input.approvedBy));

  return {
    allowed: checks.every((check) => check.status === 'pass'),
    checks,
    blockingReasons: checks.filter((check) => check.status === 'fail').map((check) => check.code),
  };
}

module.exports = { evaluateDecisionDashboardClosure };
