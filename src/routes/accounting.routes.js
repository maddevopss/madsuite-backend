const express = require('express');
const ApiResponse = require('../utils/apiResponse');
const { requireOrganisation } = require('../middleware/organization.middleware');
const { getOrganisationId } = require('../utils/organisationScope');
const service = require('../services/accounting/accounting.service');

const router = express.Router();
router.use(requireOrganisation);
const organisationId = (req) => getOrganisationId(req);

router.post('/setup', async (req, res, next) => {
  try {
    const accounts = await service.seedDefaultChart({ organisationId: organisationId(req) });
    return res.status(201).json(ApiResponse.success('ACCOUNTING_SETUP_COMPLETED', accounts));
  } catch (error) { return next(error); }
});

router.get('/accounts', async (req, res, next) => {
  try {
    const accounts = await service.listAccounts({
      organisationId: organisationId(req),
      activeOnly: req.query.all !== '1',
    });
    return res.json(ApiResponse.success('ACCOUNTING_ACCOUNTS_LISTED', accounts));
  } catch (error) { return next(error); }
});

router.post('/accounts', async (req, res, next) => {
  try {
    const account = await service.createAccount({ organisationId: organisationId(req), data: req.body });
    return res.status(201).json(ApiResponse.success('ACCOUNTING_ACCOUNT_CREATED', account));
  } catch (error) { return next(error); }
});

router.get('/periods', async (req, res, next) => {
  try {
    return res.json(ApiResponse.success('ACCOUNTING_PERIODS_LISTED', await service.listPeriods({ organisationId: organisationId(req) })));
  } catch (error) { return next(error); }
});

router.post('/periods', async (req, res, next) => {
  try {
    const period = await service.createPeriod({ organisationId: organisationId(req), data: req.body });
    return res.status(201).json(ApiResponse.success('ACCOUNTING_PERIOD_CREATED', period));
  } catch (error) { return next(error); }
});

router.patch('/periods/:id/status', async (req, res, next) => {
  try {
    const period = await service.setPeriodStatus({
      organisationId: organisationId(req),
      periodId: req.params.id,
      status: req.body.status,
      userId: req.user?.id,
    });
    return res.json(ApiResponse.success('ACCOUNTING_PERIOD_STATUS_UPDATED', period));
  } catch (error) { return next(error); }
});

router.get('/journal', async (req, res, next) => {
  try {
    const rows = await service.listJournal({
      organisationId: organisationId(req),
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
    });
    return res.json(ApiResponse.success('ACCOUNTING_JOURNAL_LISTED', rows));
  } catch (error) { return next(error); }
});

router.post('/journal', async (req, res, next) => {
  try {
    const entry = await service.createJournalEntry({
      organisationId: organisationId(req),
      userId: req.user?.id,
      data: req.body,
    });
    return res.status(201).json(ApiResponse.success('ACCOUNTING_ENTRY_CREATED', entry));
  } catch (error) { return next(error); }
});

router.get('/journal/:id', async (req, res, next) => {
  try {
    const entry = await service.getJournalEntry({ organisationId: organisationId(req), entryId: req.params.id });
    if (!entry) return res.status(404).json(ApiResponse.error('NOT_FOUND', { message: 'Écriture introuvable.' }));
    return res.json(ApiResponse.success('ACCOUNTING_ENTRY_READ', entry));
  } catch (error) { return next(error); }
});

router.post('/journal/:id/post', async (req, res, next) => {
  try {
    const entry = await service.postJournalEntry({
      organisationId: organisationId(req),
      entryId: req.params.id,
      userId: req.user?.id,
    });
    return res.json(ApiResponse.success('ACCOUNTING_ENTRY_POSTED', entry));
  } catch (error) { return next(error); }
});

router.post('/journal/:id/reverse', async (req, res, next) => {
  try {
    const entry = await service.reverseJournalEntry({
      organisationId: organisationId(req),
      entryId: req.params.id,
      userId: req.user?.id,
      date: req.body.date,
      periodId: req.body.period_id,
    });
    return res.status(201).json(ApiResponse.success('ACCOUNTING_ENTRY_REVERSED', entry));
  } catch (error) { return next(error); }
});

router.get('/ledger/:accountId', async (req, res, next) => {
  try {
    const rows = await service.getLedger({
      organisationId: organisationId(req),
      accountId: req.params.accountId,
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(ApiResponse.success('ACCOUNTING_LEDGER_READ', rows));
  } catch (error) { return next(error); }
});

router.get('/trial-balance', async (req, res, next) => {
  try {
    const report = await service.trialBalance({
      organisationId: organisationId(req),
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(ApiResponse.success('ACCOUNTING_TRIAL_BALANCE_READ', report));
  } catch (error) { return next(error); }
});

router.get('/statements', async (req, res, next) => {
  try {
    const statements = await service.financialStatements({
      organisationId: organisationId(req),
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(ApiResponse.success('ACCOUNTING_STATEMENTS_READ', statements));
  } catch (error) { return next(error); }
});

router.get('/export/trial-balance.csv', async (req, res, next) => {
  try {
    const report = await service.trialBalance({
      organisationId: organisationId(req),
      from: req.query.from,
      to: req.query.to,
    });
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [
      'Compte,Nom,Débit,Crédit,Solde',
      ...report.rows.map((row) => [row.code, row.name, row.debit, row.credit, row.net].map(escape).join(',')),
    ].join('\n');
    return res.type('text/csv').set('Content-Disposition', 'attachment; filename="balance-verification.csv"').send(csv);
  } catch (error) { return next(error); }
});

module.exports = router;
