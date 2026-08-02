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
    [{ legalFirstName: 'Marie', legalLastName: 'Tremblay' }, 'Le numéro d’employé est obligatoire.'],
    [{ employeeNumber: 'EMP-001', legalLastName: 'Tremblay' }, 'Le prénom légal est obligatoire.'],
    [{ employeeNumber: 'EMP-001', legalFirstName: 'Marie' }, 'Le nom de famille légal est obligatoire.'],
    [{ employeeNumber: 'EMP-001', legalFirstName: 'Marie', legalLastName: 'Tremblay', employmentStatus: 'unknown' }, 'Le statut d’emploi est invalide.'],
  ])('rejects invalid identity data', (input, message) => {
    expect(() => normalizeEmployeeRecord(input)).toThrow(message);
  });

  test('les erreurs de validation portent un statusCode 400 (cohérent avec le reste de l’API)', () => {
    expect.assertions(1);
    try {
      normalizeEmployeeRecord({});
    } catch (error) {
      expect(error.statusCode).toBe(400);
    }
  });

  test('rejects a termination before hiring', () => {
    expect(() => normalizeEmployeeRecord({
      employeeNumber: 'EMP-002',
      legalFirstName: 'Alex',
      legalLastName: 'Roy',
      hireDate: '2026-07-20',
      terminationDate: '2026-07-19',
    })).toThrow('La date de fin d’emploi ne peut pas précéder la date d’embauche.');
  });

  test('only active and non-archived employees participate in payroll', () => {
    expect(canParticipateInPayroll({ employmentStatus: 'active', archivedAt: null })).toBe(true);
    expect(canParticipateInPayroll({ employmentStatus: 'leave', archivedAt: null })).toBe(false);
    expect(canParticipateInPayroll({ employmentStatus: 'active', archivedAt: '2026-07-27T00:00:00Z' })).toBe(false);
  });
});
