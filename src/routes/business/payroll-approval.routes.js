'use strict';

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { assertCanApprove } = require('../../services/business/payroll-approval-policy.service');
const { evaluateApproval } = require('../../services/business/payroll-approval.service');
const payrollService = require('../../services/business/payroll-transaction.service');

router.use(requireOrganisation);

// Code de politique unique : un cycle de paie n'a qu'un seul palier
// d'approbation (contrairement à un workflow à étapes nommées comme
// "révision finance" / "révision RH"), donc un seul code suffit.
const POLICY_CODE = 'payroll_run_approval';

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  }
  return id;
}

router.get('/approval-policy', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM payroll_approval_policies WHERE organisation_id=$1 AND code=$2`,
      [req.organisationId, POLICY_CODE],
    );
    return res.json({ policy: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.post('/approval-policy', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const minimumApprovers = Number(body.minimumApprovers ?? 2);
    if (!Number.isInteger(minimumApprovers) || minimumApprovers < 1) {
      return res.status(400).json({ message: 'Le nombre minimal d’approbateurs doit être un entier positif.' });
    }
    const prohibitSelfApproval = body.prohibitSelfApproval !== false;
    const active = body.active !== false;
    const { rows } = await req.db.query(
      `INSERT INTO payroll_approval_policies (organisation_id, code, minimum_approvers, prohibit_self_approval, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organisation_id, code)
       DO UPDATE SET minimum_approvers=EXCLUDED.minimum_approvers, prohibit_self_approval=EXCLUDED.prohibit_self_approval, active=EXCLUDED.active
       RETURNING *`,
      [req.organisationId, POLICY_CODE, minimumApprovers, prohibitSelfApproval, active],
    );
    return res.status(201).json({ policy: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/runs/:id/approval-decisions', requireRole('admin'), async (req, res, next) => {
  try {
    const runId = positiveId(req.params.id, 'Cycle');
    const { rows } = await req.db.query(
      `SELECT * FROM payroll_approval_steps WHERE organisation_id=$1 AND payroll_run_id=$2 ORDER BY decided_at`,
      [req.organisationId, runId],
    );
    return res.json({ decisions: rows });
  } catch (error) {
    return next(error);
  }
});

// Chaque approbateur distinct enregistre sa propre décision (step_code
// identifie l'approbateur, pas une étape nommée : payroll_approval_steps
// n'autorise qu'une ligne par (cycle, step_code), et evaluateApproval
// dédoublonne déjà par decidedBy — minimum_approvers exige donc des
// approbateurs distincts, pas des étapes métier distinctes). Une fois le
// nombre requis de décisions "approved" atteint, le cycle est transitionné
// via la même transitionRun que l'approbation à un seul palier (mêmes
// garanties transactionnelles, événement et évaluation de confiance).
router.post('/runs/:id/approval-decisions', requireRole('admin'), async (req, res, next) => {
  try {
    const runId = positiveId(req.params.id, 'Cycle');
    const decision = String(req.body?.decision || '').trim();
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'La décision doit être "approved" ou "rejected".' });
    }
    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    const decidedBy = req.user?.id;
    if (!decidedBy) {
      return res.status(400).json({ message: 'Un approbateur identifié est obligatoire.' });
    }

    const policyRes = await req.db.query(
      `SELECT * FROM payroll_approval_policies WHERE organisation_id=$1 AND code=$2 AND active=TRUE`,
      [req.organisationId, POLICY_CODE],
    );
    const policy = policyRes.rows[0];
    if (!policy) {
      return res.status(409).json({ message: 'Aucune politique d’approbation multi-approbateurs active pour cette organisation.' });
    }

    const runRes = await req.db.query(`SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2`, [req.organisationId, runId]);
    const run = runRes.rows[0];
    if (!run) return res.status(404).json({ message: 'Cycle de paie introuvable.' });
    if (run.status !== 'calculated') {
      return res.status(409).json({ message: 'Ce cycle n’est plus en attente d’approbation.' });
    }

    if (decision === 'approved' && policy.prohibit_self_approval) {
      assertCanApprove({ preparedBy: run.calculated_by, approverId: decidedBy });
    }

    const stepCode = `approver:${decidedBy}`;
    await req.db.query(
      `INSERT INTO payroll_approval_steps
         (organisation_id, payroll_run_id, step_code, status, required_role, decided_by, decided_at, reason)
       VALUES ($1,$2,$3,$4,'admin',$5,NOW(),$6)
       ON CONFLICT (organisation_id, payroll_run_id, step_code)
       DO UPDATE SET status=EXCLUDED.status, decided_at=NOW(), reason=EXCLUDED.reason`,
      [req.organisationId, runId, stepCode, decision, decidedBy, reason],
    );

    const decisionsRes = await req.db.query(
      `SELECT decided_by, status FROM payroll_approval_steps WHERE organisation_id=$1 AND payroll_run_id=$2`,
      [req.organisationId, runId],
    );
    const evaluation = evaluateApproval({
      createdBy: policy.prohibit_self_approval ? run.calculated_by : null,
      decisions: decisionsRes.rows.map((row) => ({ status: row.status, decidedBy: row.decided_by })),
      minimumApprovers: policy.minimum_approvers,
      prohibitSelfApproval: policy.prohibit_self_approval,
    });

    if (!evaluation.ready) {
      return res.status(200).json({ decision, evaluation, run });
    }

    const result = await payrollService.transitionRun({
      organisationId: req.organisationId,
      runId,
      action: 'approve',
      idempotencyKey: crypto.randomUUID(),
      createdBy: decidedBy,
      skipMultiApproverGate: true,
    });
    return res.status(201).json({ decision, evaluation, run: result.run });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
