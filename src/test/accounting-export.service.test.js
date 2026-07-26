const service = require('../services/business/accounting-export.service');

describe('accounting-export.service', () => {
  test('échappe correctement les cellules CSV', () => {
    expect(service.csvCell('Revenus "Québec"')).toBe('"Revenus ""Québec"""');
  });

  test('produit une balance de vérification CSV isolée par organisation', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{ code: '1000', name: 'Encaisse', account_type: 'asset', debit: '125.00', credit: '0.00', balance: '125.00' }],
      }),
    };

    const csv = await service.trialBalanceCsv(db, 'org-a', '2026-01-01', '2026-12-31');

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('a.organisation_id=$1'), ['org-a', '2026-01-01', '2026-12-31']);
    expect(csv).toContain('"1000","Encaisse","asset","125.00","0.00","125.00"');
  });

  test('calcule le mouvement net de trésorerie depuis les écritures publiées', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { entry_date: '2026-01-03', entry_number: 'VEN-1', description: 'Paiement', cash_movement: '250.00' },
          { entry_date: '2026-01-04', entry_number: 'ACH-1', description: 'Dépense', cash_movement: '-75.50' },
        ],
      }),
    };

    const report = await service.cashFlow(db, 'org-a', null, '2026-12-31');

    expect(report.netCashMovement).toBe(174.5);
    expect(report.traceable).toBe(true);
    expect(report.movements).toHaveLength(2);
  });
});
