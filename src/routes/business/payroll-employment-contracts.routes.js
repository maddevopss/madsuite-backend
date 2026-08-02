'use strict';

// Suite de #698 (lacune documentée : payroll-employment-contract.service.js —
// table payroll_employment_contracts créée par migration mais jamais
// exploitée par aucune route). Décision produit : câbler une capacité
// minimale réelle — CRUD + cycle de vie brouillon → approuvé → actif →
// (remplacé | terminé | annulé), avec le même garde-fou préparateur/
// approbateur que le reste du module Paie (préparation ouverte à
// admin/manager, gouvernance réservée à admin).

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const {
  normalizeEmploymentContract,
  canActivateContract,
} = require('../../services/business/payroll-employment-contract.service');

router.use(requireOrganisation);

const preparer = requireRole('admin', 'manager');
const approver = requireRole('admin');

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

async function assertEmployeeBelongsToOrganisation(db, organisationId, employeeId) {
  const { rows } = await db.query('SELECT id FROM payroll_employees WHERE organisation_id=$1 AND id=$2', [organisationId, employeeId]);
  if (!rows[0]) throw Object.assign(new Error('Employé introuvable dans cette organisation.'), { statusCode: 404 });
}

// canActivateContract() (service) attend des clés camelCase alors que les
// colonnes en base sont snake_case.
function toContractGate(row) {
  return {
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    effectiveFrom: row.effective_from,
  };
}

router.get('/employees/:employeeId/contracts', preparer, async (req, res, next) => {
  try {
    const employeeId = positiveId(req.params.employeeId, 'Employé');
    const { rows } = await req.db.query(
      `SELECT * FROM payroll_employment_contracts WHERE organisation_id=$1 AND employee_id=$2 ORDER BY effective_from DESC, id DESC`,
      [req.organisationId, employeeId],
    );
    return res.json({ contracts: rows });
  } catch (error) { return next(error); }
});

router.post('/employees/:employeeId/contracts', preparer, async (req, res, next) => {
  try {
    const employeeId = positiveId(req.params.employeeId, 'Employé');
    await assertEmployeeBelongsToOrganisation(req.db, req.organisationId, employeeId);
    const contract = normalizeEmploymentContract(req.body || {});
    const { rows } = await req.db.query(
      `INSERT INTO payroll_employment_contracts (
         organisation_id, employee_id, contract_number, contract_type, employment_class, pay_type,
         hourly_rate, annual_salary, standard_hours_per_week, pay_frequency, effective_from, effective_to,
         terms, source_document_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        req.organisationId, employeeId, contract.contractNumber, contract.contractType, contract.employmentClass,
        contract.payType, contract.hourlyRate, contract.annualSalary, contract.standardHoursPerWeek,
        contract.payFrequency, contract.effectiveFrom, contract.effectiveTo, JSON.stringify(contract.terms),
        req.body?.sourceDocumentId || null, req.user?.id || null,
      ],
    );
    return res.status(201).json({ contract: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Ce numéro de contrat existe déjà pour cette organisation.' });
    return next(error);
  }
});

router.get('/contracts/:id', preparer, async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Contrat');
    const { rows } = await req.db.query('SELECT * FROM payroll_employment_contracts WHERE organisation_id=$1 AND id=$2', [req.organisationId, id]);
    if (!rows[0]) return res.status(404).json({ message: 'Contrat introuvable.' });
    return res.json({ contract: rows[0] });
  } catch (error) { return next(error); }
});

// L'approbation ne fait qu'enregistrer approved_by/approved_at — elle ne
// suffit pas à elle seule à rendre le contrat actif : c'est /activate qui
// applique canActivateContract() (brouillon + approuvé + date d'effet) et
// gère le remplacement de l'éventuel contrat déjà actif de l'employé.
router.post('/contracts/:id/approve', approver, async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Contrat');
    // approved_by IS NULL en plus de status='draft' : une approbation est un
    // geste ponctuel, pas un champ librement réécrivable — un contrat déjà
    // approuvé (encore en brouillon tant qu'il n'est pas activé) ne peut pas
    // être approuvé une seconde fois silencieusement par un autre admin.
    const { rows } = await req.db.query(
      `UPDATE payroll_employment_contracts SET approved_by=$3, approved_at=NOW(), updated_at=NOW()
       WHERE organisation_id=$1 AND id=$2 AND status='draft' AND approved_by IS NULL RETURNING *`,
      [req.organisationId, id, req.user?.id || null],
    );
    if (!rows[0]) {
      const exists = await req.db.query('SELECT status, approved_by FROM payroll_employment_contracts WHERE organisation_id=$1 AND id=$2', [req.organisationId, id]);
      if (!exists.rows[0]) return res.status(404).json({ message: 'Contrat introuvable.' });
      return res.status(409).json({ message: 'Seul un contrat en brouillon et pas encore approuvé peut être approuvé.' });
    }
    return res.status(201).json({ contract: rows[0] });
  } catch (error) { return next(error); }
});

// uq_payroll_active_contract_per_employee (migration) n'autorise qu'un seul
// contrat 'active' par employé : on rétrograde donc explicitement l'éventuel
// contrat déjà actif en 'superseded' avant d'activer le nouveau, dans la
// même transaction (verrou de ligne via FOR UPDATE sur le contrat ciblé).
router.post('/contracts/:id/activate', approver, async (req, res, next) => {
  const client = req.db;
  try {
    const id = positiveId(req.params.id, 'Contrat');
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM payroll_employment_contracts WHERE organisation_id=$1 AND id=$2 FOR UPDATE', [req.organisationId, id]);
    const contract = current.rows[0];
    if (!contract) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Contrat introuvable.' }); }
    if (!canActivateContract(toContractGate(contract))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Le contrat doit être en brouillon et approuvé, avec une date d’effet, pour être activé.' });
    }
    await client.query(
      `UPDATE payroll_employment_contracts SET status='superseded', updated_at=NOW()
       WHERE organisation_id=$1 AND employee_id=$2 AND status='active'`,
      [req.organisationId, contract.employee_id],
    );
    const { rows } = await client.query(
      `UPDATE payroll_employment_contracts SET status='active', updated_at=NOW()
       WHERE organisation_id=$1 AND id=$2 RETURNING *`,
      [req.organisationId, id],
    );
    await client.query('COMMIT');
    return res.status(201).json({ contract: rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connexion déjà perdue */ }
    if (error.code === '23505') return res.status(409).json({ message: 'Un contrat actif existe déjà pour cet employé.' });
    return next(error);
  }
});

router.post('/contracts/:id/end', approver, async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Contrat');
    const current = await req.db.query('SELECT * FROM payroll_employment_contracts WHERE organisation_id=$1 AND id=$2', [req.organisationId, id]);
    const contract = current.rows[0];
    if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' });
    if (contract.status !== 'active') return res.status(409).json({ message: 'Seul un contrat actif peut être terminé.' });
    const effectiveTo = req.body?.effectiveTo ? String(req.body.effectiveTo).trim() : new Date().toISOString().slice(0, 10);
    if (new Date(effectiveTo) < new Date(contract.effective_from)) {
      return res.status(400).json({ message: 'La date de fin ne peut pas précéder la date d’effet du contrat.' });
    }
    const { rows } = await req.db.query(
      `UPDATE payroll_employment_contracts SET status='ended', effective_to=$3, updated_at=NOW()
       WHERE organisation_id=$1 AND id=$2 AND status='active' RETURNING *`,
      [req.organisationId, id, effectiveTo],
    );
    if (!rows[0]) return res.status(409).json({ message: 'Seul un contrat actif peut être terminé.' });
    return res.json({ contract: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/contracts/:id/cancel', approver, async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Contrat');
    const { rows } = await req.db.query(
      `UPDATE payroll_employment_contracts SET status='cancelled', updated_at=NOW()
       WHERE organisation_id=$1 AND id=$2 AND status IN ('draft','active') RETURNING *`,
      [req.organisationId, id],
    );
    if (!rows[0]) {
      const exists = await req.db.query('SELECT status FROM payroll_employment_contracts WHERE organisation_id=$1 AND id=$2', [req.organisationId, id]);
      if (!exists.rows[0]) return res.status(404).json({ message: 'Contrat introuvable.' });
      return res.status(409).json({ message: 'Seul un contrat en brouillon ou actif peut être annulé.' });
    }
    return res.json({ contract: rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
