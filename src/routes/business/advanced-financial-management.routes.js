const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
require('../../services/business/advanced-financial-management-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.get('/budgets', (req, res, next) => handle(res, next, async () => (
  await db.pool.query('SELECT * FROM financial_budgets WHERE organisation_id=$1 ORDER BY fiscal_year DESC, budget_number', [org(req)])
).rows));
router.post('/budgets', (req, res, next) => handle(res, next, async () => (
  await db.pool.query(`INSERT INTO financial_budgets (organisation_id,budget_number,name,fiscal_year,currency,owner_user_id,total_revenue,total_expense,allocations,assumptions,status,effective_from,effective_to,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [org(req), req.body.budgetNumber, req.body.name, req.body.fiscalYear, req.body.currency || 'CAD', req.body.ownerUserId, req.body.totalRevenue || 0, req.body.totalExpense || 0, req.body.allocations || [], req.body.assumptions || [], req.body.status || 'draft', req.body.effectiveFrom || null, req.body.effectiveTo || null, req.get('Idempotency-Key') || req.body.idempotencyKey])
).rows[0], 201));

router.get('/forecasts', (req, res, next) => handle(res, next, async () => (
  await db.pool.query('SELECT * FROM financial_forecasts WHERE organisation_id=$1 ORDER BY period_start DESC', [org(req)])
).rows));
router.post('/forecasts', (req, res, next) => handle(res, next, async () => (
  await db.pool.query(`INSERT INTO financial_forecasts (organisation_id,forecast_number,name,period_start,period_end,currency,prepared_by_user_id,forecast_data,assumptions,risks,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [org(req), req.body.forecastNumber, req.body.name, req.body.periodStart, req.body.periodEnd, req.body.currency || 'CAD', req.body.preparedByUserId, req.body.forecastData || {}, req.body.assumptions || [], req.body.risks || [], req.body.status || 'draft', req.get('Idempotency-Key') || req.body.idempotencyKey])
).rows[0], 201));

router.get('/cash-positions', (req, res, next) => handle(res, next, async () => (
  await db.pool.query('SELECT * FROM financial_cash_positions WHERE organisation_id=$1 ORDER BY position_date DESC', [org(req)])
).rows));
router.post('/cash-positions', (req, res, next) => handle(res, next, async () => (
  await db.pool.query(`INSERT INTO financial_cash_positions (organisation_id,position_date,account_reference,currency,opening_balance,inflows,outflows,closing_balance,source_evidence,prepared_by_user_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [org(req), req.body.positionDate, req.body.accountReference, req.body.currency || 'CAD', req.body.openingBalance, req.body.inflows || 0, req.body.outflows || 0, req.body.closingBalance, req.body.sourceEvidence || [], req.body.preparedByUserId, req.get('Idempotency-Key') || req.body.idempotencyKey])
).rows[0], 201));

router.get('/funding-facilities', (req, res, next) => handle(res, next, async () => (
  await db.pool.query('SELECT * FROM financial_funding_facilities WHERE organisation_id=$1 ORDER BY matures_at', [org(req)])
).rows));
router.post('/funding-facilities', (req, res, next) => handle(res, next, async () => (
  await db.pool.query(`INSERT INTO financial_funding_facilities (organisation_id,facility_number,facility_type,provider_name,currency,approved_limit,drawn_amount,interest_rate,starts_at,matures_at,covenants,evidence,approved_by_user_id,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [org(req), req.body.facilityNumber, req.body.facilityType, req.body.providerName, req.body.currency || 'CAD', req.body.approvedLimit, req.body.drawnAmount || 0, req.body.interestRate || null, req.body.startsAt, req.body.maturesAt, req.body.covenants || [], req.body.evidence || [], req.body.approvedByUserId, req.body.status || 'active', req.get('Idempotency-Key') || req.body.idempotencyKey])
).rows[0], 201));

router.get('/scenarios', (req, res, next) => handle(res, next, async () => (
  await db.pool.query('SELECT * FROM financial_scenarios WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])
).rows));
router.post('/scenarios', (req, res, next) => handle(res, next, async () => (
  await db.pool.query(`INSERT INTO financial_scenarios (organisation_id,scenario_number,name,scenario_type,baseline_reference,assumptions,projected_results,risks,recommendations,prepared_by_user_id,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [org(req), req.body.scenarioNumber, req.body.name, req.body.scenarioType, req.body.baselineReference || null, req.body.assumptions || [], req.body.projectedResults || {}, req.body.risks || [], req.body.recommendations || [], req.body.preparedByUserId, req.body.status || 'draft', req.get('Idempotency-Key') || req.body.idempotencyKey])
).rows[0], 201));

router.get('/alerts', (req, res, next) => handle(res, next, async () => {
  const facilities = await db.pool.query(`SELECT * FROM financial_funding_facilities WHERE organisation_id=$1 AND status='active' AND matures_at <= CURRENT_DATE + INTERVAL '90 days' ORDER BY matures_at`, [org(req)]);
  const negativeCash = await db.pool.query(`SELECT * FROM financial_cash_positions WHERE organisation_id=$1 AND closing_balance < 0 ORDER BY position_date DESC`, [org(req)]);
  return { facilitiesExpiring: facilities.rows, negativeCashPositions: negativeCash.rows };
}));

module.exports = router;
