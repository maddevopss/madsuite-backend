const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction, evaluatePolicy } = require('../../services/business/transaction-engine.service');
const { checkBlockClosure } = require('../../utils/blockClosureValidation');
require('../../services/business/advanced-financial-management-transaction.service');

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);
const requireKey = (req, res) => { if (!key(req) || String(key(req)).trim().length < 8) { res.status(400).json({ code: 'finance.idempotency_required' }); return false; } return true; };

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({ type, organisationId: org(req), actorUserId: actor(req), idempotencyKey: key(req), policies: policy ? [`${policy}@1`] : [], input, execute });
  return transaction.result;
}

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

function deny(decision) {
  const error = new Error(decision.code || decision.reason || 'finance.policy_denied');
  error.statusCode = decision.statusCode || 409;
  throw error;
}

router.get('/budgets', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM financial_budgets WHERE organisation_id=$1 ORDER BY fiscal_year DESC, budget_number', [org(req)])).rows));
router.post('/budgets', (req, res, next) => {
  if (!requireKey(req, res)) return;
  return handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'finance.budget.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO financial_budgets (organisation_id,budget_number,name,fiscal_year,currency,owner_user_id,total_revenue,total_expense,allocations,assumptions,status,effective_from,effective_to,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [organisationId,input.budgetNumber,input.name,input.fiscalYear,input.currency||'CAD',input.ownerUserId,input.totalRevenue||0,input.totalExpense||0,JSON.stringify(input.allocations||[]),JSON.stringify(input.assumptions||[]),input.status||'draft',input.effectiveFrom||null,input.effectiveTo||null,idempotencyKey])).rows[0]);
  }, 201);
});
router.post('/budgets/:id/approve', (req,res,next) => handle(res,next,() => transactionalWrite(req,'finance.budget.approve',null,{...req.body,budgetId:req.params.id},async ({ client, organisationId, idempotencyKey }) => {
  const budget = (await client.query('SELECT id,status,owner_user_id,total_revenue,total_expense,allocations,assumptions FROM financial_budgets WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!budget) throw notFound('finance.budget_not_found');
  checkBlockClosure(budget, { finalStates: ['approved'] });
  const input = { ...req.body, budgetId:req.params.id, ownerUserId:budget.owner_user_id, approvedByUserId:req.body.approvedByUserId||actor(req), totalRevenue:budget.total_revenue, totalExpense:budget.total_expense, allocations:budget.allocations, assumptions:budget.assumptions };
  const decision = await evaluatePolicy({ policy:'finance.budget.approve@1', input, idempotencyKey, organisationId, actorUserId:actor(req), client });
  if (!decision.allowed) deny(decision);
  return (await client.query(`UPDATE financial_budgets SET approved_by_user_id=$1,approval_evidence=$2,status='approved',effective_from=COALESCE($3,effective_from),effective_to=COALESCE($4,effective_to),updated_at=NOW() WHERE id=$5 AND organisation_id=$6 RETURNING *`,[input.approvedByUserId,JSON.stringify(input.approvalEvidence||[]),input.effectiveFrom||null,input.effectiveTo||null,req.params.id,organisationId])).rows[0];
})));

router.get('/forecasts', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM financial_forecasts WHERE organisation_id=$1 ORDER BY period_start DESC', [org(req)])).rows));
router.post('/forecasts', (req, res, next) => {
  if (!requireKey(req, res)) return;
  return handle(res, next, () => {
  const input = { ...req.body, preparedByUserId: req.body.preparedByUserId || actor(req) };
  return transactionalWrite(req, 'finance.forecast.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO financial_forecasts (organisation_id,forecast_number,name,period_start,period_end,currency,prepared_by_user_id,forecast_data,assumptions,risks,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId,input.forecastNumber,input.name,input.periodStart,input.periodEnd,input.currency||'CAD',input.preparedByUserId,JSON.stringify(input.forecastData||{}),JSON.stringify(input.assumptions||[]),JSON.stringify(input.risks||[]),input.status||'draft',idempotencyKey])).rows[0]);
  }, 201);
});
router.post('/forecasts/:id/publish', (req,res,next) => handle(res,next,() => transactionalWrite(req,'finance.forecast.publish',null,{...req.body,forecastId:req.params.id},async ({ client, organisationId, idempotencyKey }) => {
  const forecast = (await client.query('SELECT id,status,prepared_by_user_id,period_start,period_end,assumptions FROM financial_forecasts WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!forecast) throw notFound('finance.forecast_not_found');
  checkBlockClosure(forecast, { finalStates: ['published'] });
  const input = { ...req.body, forecastId:req.params.id, preparedByUserId:forecast.prepared_by_user_id, approvedByUserId:req.body.approvedByUserId||actor(req), periodStart:forecast.period_start, periodEnd:forecast.period_end, assumptions:forecast.assumptions };
  const decision = await evaluatePolicy({ policy:'finance.forecast.publish@1', input, idempotencyKey, organisationId, actorUserId:actor(req), client });
  if (!decision.allowed) deny(decision);
  return (await client.query(`UPDATE financial_forecasts SET approved_by_user_id=$1,approval_evidence=$2,status='published',updated_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *`,[input.approvedByUserId,JSON.stringify(input.approvalEvidence||[]),req.params.id,organisationId])).rows[0];
})));

router.get('/cash-positions', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM financial_cash_positions WHERE organisation_id=$1 ORDER BY position_date DESC', [org(req)])).rows));
router.post('/cash-positions', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, preparedByUserId: req.body.preparedByUserId || actor(req) };
  return transactionalWrite(req, 'finance.cash_position.record', 'finance.cash_position.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO financial_cash_positions (organisation_id,position_date,account_reference,currency,opening_balance,inflows,outflows,closing_balance,source_evidence,prepared_by_user_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [organisationId,input.positionDate,input.accountReference,input.currency||'CAD',input.openingBalance,input.inflows||0,input.outflows||0,input.closingBalance,JSON.stringify(input.sourceEvidence||[]),input.preparedByUserId,idempotencyKey])).rows[0]);
}, 201));

router.get('/funding-facilities', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM financial_funding_facilities WHERE organisation_id=$1 ORDER BY matures_at', [org(req)])).rows));
router.post('/funding-facilities', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, approvedByUserId: req.body.approvedByUserId || actor(req) };
  return transactionalWrite(req, 'finance.funding_facility.approve', 'finance.funding_facility.approve', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO financial_funding_facilities (organisation_id,facility_number,facility_type,provider_name,currency,approved_limit,drawn_amount,interest_rate,starts_at,matures_at,covenants,evidence,approved_by_user_id,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [organisationId,input.facilityNumber,input.facilityType,input.providerName,input.currency||'CAD',input.approvedLimit,input.drawnAmount||0,input.interestRate||null,input.startsAt,input.maturesAt,JSON.stringify(input.covenants||[]),JSON.stringify(input.evidence||[]),input.approvedByUserId,input.status||'active',idempotencyKey])).rows[0]);
}, 201));

router.get('/scenarios', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM financial_scenarios WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/scenarios', (req, res, next) => {
  if (!requireKey(req, res)) return;
  return handle(res, next, () => {
  const input = { ...req.body, preparedByUserId: req.body.preparedByUserId || actor(req) };
  return transactionalWrite(req, 'finance.scenario.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO financial_scenarios (organisation_id,scenario_number,name,scenario_type,baseline_reference,assumptions,projected_results,risks,recommendations,prepared_by_user_id,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId,input.scenarioNumber,input.name,input.scenarioType,input.baselineReference||null,JSON.stringify(input.assumptions||[]),JSON.stringify(input.projectedResults||{}),JSON.stringify(input.risks||[]),JSON.stringify(input.recommendations||[]),input.preparedByUserId,input.status||'draft',idempotencyKey])).rows[0]);
  }, 201);
});
router.post('/scenarios/:id/approve', (req,res,next) => handle(res,next,() => transactionalWrite(req,'finance.scenario.approve',null,{...req.body,scenarioId:req.params.id},async ({ client, organisationId, idempotencyKey }) => {
  const scenario = (await client.query('SELECT id,status,prepared_by_user_id,assumptions,recommendations FROM financial_scenarios WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!scenario) throw notFound('finance.scenario_not_found');
  checkBlockClosure(scenario, { finalStates: ['approved'] });
  const input = { ...req.body, scenarioId:req.params.id, preparedByUserId:scenario.prepared_by_user_id, approvedByUserId:req.body.approvedByUserId||actor(req), assumptions:scenario.assumptions, recommendations:scenario.recommendations };
  const decision = await evaluatePolicy({ policy:'finance.scenario.approve@1', input, idempotencyKey, organisationId, actorUserId:actor(req), client });
  if (!decision.allowed) deny(decision);
  return (await client.query(`UPDATE financial_scenarios SET approved_by_user_id=$1,approval_evidence=$2,status='approved',updated_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *`,[input.approvedByUserId,JSON.stringify(input.approvalEvidence||[]),req.params.id,organisationId])).rows[0];
})));

router.get('/alerts', (req, res, next) => handle(res, next, async () => {
  const facilities = await db.query(`SELECT * FROM financial_funding_facilities WHERE organisation_id=$1 AND status='active' AND matures_at <= CURRENT_DATE + INTERVAL '90 days' ORDER BY matures_at`, [org(req)]);
  const negativeCash = await db.query(`SELECT * FROM financial_cash_positions WHERE organisation_id=$1 AND closing_balance < 0 ORDER BY position_date DESC`, [org(req)]);
  return { facilitiesExpiring: facilities.rows, negativeCashPositions: negativeCash.rows };
}));

module.exports = router;
