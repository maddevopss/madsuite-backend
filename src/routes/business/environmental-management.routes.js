const express = require("express");
const pool = require("../../../db");
const { evaluatePolicy } = require("../../services/business/transaction-engine.service");
require("../../services/business/environmental-management-transaction.service");

const router = express.Router();
const orgId = (req) => req.user.organisation_id;

const resources = {
  permits: "environmental_permits",
  incidents: "environmental_incidents",
  inspections: "environmental_inspections",
  "corrective-actions": "environmental_corrective_actions",
  metrics: "environmental_metrics",
  reports: "environmental_reports",
};

for (const [path, table] of Object.entries(resources)) {
  router.get(`/${path}`, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE organisation_id = $1 ORDER BY created_at DESC`, [orgId(req)]);
      res.json({ success: true, data: rows });
    } catch (error) { next(error); }
  });
}

const createRoute = (path, table, policy, columns) => {
  router.post(path, async (req, res, next) => {
    try {
      await evaluatePolicy({ policy, input: req.body, idempotencyKey: req.get("Idempotency-Key") });
      const names = ["organisation_id", ...columns];
      const values = [orgId(req), ...columns.map((column) => req.body[column])];
      const placeholders = names.map((_, index) => `$${index + 1}`).join(", ");
      const { rows } = await pool.query(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders}) RETURNING *`, values);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (error) { next(error); }
  });
};

createRoute("/permits", "environmental_permits", "environment.permit.register@1", ["site_id", "permit_type", "permit_number", "issuing_authority", "issued_at", "expires_at", "proof_refs", "created_by"]);
createRoute("/incidents", "environmental_incidents", "environment.incident.report@1", ["site_id", "occurred_at", "incident_type", "severity", "description", "responsible_user_id", "immediate_actions", "proof_refs", "created_by"]);
createRoute("/inspections", "environmental_inspections", "environment.inspection.complete@1", ["site_id", "inspected_at", "inspector_user_id", "scope", "findings", "non_conformities", "proof_refs", "status", "completed_at"]);
createRoute("/metrics", "environmental_metrics", "environment.metric.record@1", ["site_id", "metric_type", "period_start", "period_end", "value", "unit", "methodology", "source_refs", "recorded_by"]);
createRoute("/reports", "environmental_reports", "environment.report.publish@1", ["report_type", "period_start", "period_end", "summary", "indicators", "risks", "proof_refs", "prepared_by", "approved_by", "status", "published_at"]);

router.post("/corrective-actions/:id/close", async (req, res, next) => {
  try {
    const input = { ...req.body, actionId: req.params.id };
    await evaluatePolicy({ policy: "environment.corrective_action.close@1", input, idempotencyKey: req.get("Idempotency-Key") });
    const { rows } = await pool.query(
      "UPDATE environmental_corrective_actions SET status = 'closed', closure_evidence = $1, closed_by = $2, closed_at = NOW() WHERE id = $3 AND organisation_id = $4 RETURNING *",
      [req.body.closureEvidence, req.body.closedBy, req.params.id, orgId(req)],
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) { next(error); }
});

router.get("/alerts", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT 'permit_expiry' AS alert_type, id, expires_at AS due_at FROM environmental_permits WHERE organisation_id = $1 AND status = 'active' AND expires_at <= CURRENT_DATE + INTERVAL '60 days'
       UNION ALL
       SELECT 'corrective_action_overdue', id, due_at FROM environmental_corrective_actions WHERE organisation_id = $1 AND status <> 'closed' AND due_at < NOW()
       ORDER BY due_at`,
      [orgId(req)],
    );
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
});

module.exports = router;
