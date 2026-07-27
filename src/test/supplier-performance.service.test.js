const { calculateSupplierScore } = require('../services/business/supplier-performance.service');

describe('supplier performance', () => {
  test('calcule un score pondéré explicable', () => {
    const result = calculateSupplierScore({
      onTimeDeliveryRate: 90,
      rejectionRate: 10,
      invoiceExceptionRate: 5,
      complianceScore: 100,
      incidentScore: 80,
    });
    expect(result.overallScore).toBe(92);
    expect(result.explanation.weights).toEqual({ onTimeDelivery: 0.3, quality: 0.2, invoiceAccuracy: 0.2, compliance: 0.2, incidents: 0.1 });
  });

  test('borne les indicateurs entre zéro et cent', () => {
    const result = calculateSupplierScore({ onTimeDeliveryRate: 140, rejectionRate: -10, invoiceExceptionRate: 200, complianceScore: 120, incidentScore: -5 });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });
});
