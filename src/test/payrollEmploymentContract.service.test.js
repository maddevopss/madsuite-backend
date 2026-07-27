const {
  normalizeEmploymentContract,
  canActivateContract,
} = require('../services/business/payroll-employment-contract.service');

describe('payroll employment contracts', () => {
  test('normalizes an hourly contract', () => {
    expect(normalizeEmploymentContract({
      contractNumber: ' CTR-001 ',
      contractType: 'permanent',
      employmentClass: 'full_time',
      payType: 'hourly',
      hourlyRate: '28.456',
      standardHoursPerWeek: 40,
      payFrequency: 'biweekly',
      effectiveFrom: '2026-08-01',
    })).toEqual(expect.objectContaining({
      contractNumber: 'CTR-001',
      hourlyRate: 28.46,
      annualSalary: null,
      standardHoursPerWeek: 40,
    }));
  });

  test('normalizes a salary contract', () => {
    expect(normalizeEmploymentContract({
      contractNumber: 'CTR-002',
      contractType: 'fixed_term',
      employmentClass: 'part_time',
      payType: 'salary',
      annualSalary: 62000,
      standardHoursPerWeek: 30,
      payFrequency: 'semimonthly',
      effectiveFrom: '2026-08-01',
      effectiveTo: '2027-07-31',
    })).toEqual(expect.objectContaining({
      annualSalary: 62000,
      hourlyRate: null,
    }));
  });

  test.each([
    [{}, 'contractNumber is required'],
    [{ contractNumber: 'C1', contractType: 'bad' }, 'invalid contractType'],
    [{ contractNumber: 'C1', contractType: 'permanent', employmentClass: 'bad' }, 'invalid employmentClass'],
  ])('rejects invalid classifications', (input, message) => {
    expect(() => normalizeEmploymentContract(input)).toThrow(message);
  });

  test('rejects incompatible compensation fields', () => {
    expect(() => normalizeEmploymentContract({
      contractNumber: 'C3',
      contractType: 'permanent',
      employmentClass: 'full_time',
      payType: 'hourly',
      hourlyRate: 30,
      annualSalary: 60000,
      standardHoursPerWeek: 40,
      payFrequency: 'biweekly',
      effectiveFrom: '2026-08-01',
    })).toThrow('annualSalary is not allowed for hourly contracts');
  });

  test('requires approval before activation', () => {
    expect(canActivateContract({ status: 'draft', approvedBy: 1, approvedAt: '2026-07-27', effectiveFrom: '2026-08-01' })).toBe(true);
    expect(canActivateContract({ status: 'draft', approvedBy: null, approvedAt: null, effectiveFrom: '2026-08-01' })).toBe(false);
    expect(canActivateContract({ status: 'active', approvedBy: 1, approvedAt: '2026-07-27', effectiveFrom: '2026-08-01' })).toBe(false);
  });
});
