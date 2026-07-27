const {
  normalizeEmployeeRecord,
  canParticipateInPayroll,
} = require('../services/business/payroll-employee-registry.service');

describe('payroll employee registry', () => {
  test('normalizes a valid employee record', () => {
    expect(normalizeEmployeeRecord({
      employeeNumber: ' EMP-001 ',
      legalFirstName: ' Marie ',
      legalLastName: ' Tremblay ',
      email: ' MARIE@EXAMPLE.CA ',
      employmentStatus: 'active',
      metadata: { source: 'onboarding' },
    })).toEqual(expect.objectContaining({
      employeeNumber: 'EMP-001',
      legalFirstName: 'Marie',
      legalLastName: 'Tremblay',
      email: 'marie@example.ca',
      employmentStatus: 'active',
      metadata: { source: 'onboarding' },
    }));
  });

  test.each([
    [{ legalFirstName: 'Marie', legalLastName: 'Tremblay' }, 'employeeNumber is required'],
    [{ employeeNumber: 'EMP-001', legalLastName: 'Tremblay' }, 'legalFirstName is required'],
    [{ employeeNumber: 'EMP-001', legalFirstName: 'Marie' }, 'legalLastName is required'],
    [{ employeeNumber: 'EMP-001', legalFirstName: 'Marie', legalLastName: 'Tremblay', employmentStatus: 'unknown' }, 'invalid employmentStatus'],
  ])('rejects invalid identity data', (input, message) => {
    expect(() => normalizeEmployeeRecord(input)).toThrow(message);
  });

  test('rejects a termination before hiring', () => {
    expect(() => normalizeEmployeeRecord({
      employeeNumber: 'EMP-002',
      legalFirstName: 'Alex',
      legalLastName: 'Roy',
      hireDate: '2026-07-20',
      terminationDate: '2026-07-19',
    })).toThrow('terminationDate cannot precede hireDate');
  });

  test('only active and non-archived employees participate in payroll', () => {
    expect(canParticipateInPayroll({ employmentStatus: 'active', archivedAt: null })).toBe(true);
    expect(canParticipateInPayroll({ employmentStatus: 'leave', archivedAt: null })).toBe(false);
    expect(canParticipateInPayroll({ employmentStatus: 'active', archivedAt: '2026-07-27T00:00:00Z' })).toBe(false);
  });
});
