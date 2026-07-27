const { calculateSupplierRisk } = require('../services/business/supplier-qualification.service');
describe('supplier qualification',()=>{
  test('approves a low-risk supplier',()=>expect(calculateSupplierRisk({financialScore:90,complianceScore:95,operationalScore:92}).status).toBe('approved'));
  test('rejects a high-risk supplier',()=>expect(calculateSupplierRisk({financialScore:20,complianceScore:30,operationalScore:25}).status).toBe('rejected'));
});