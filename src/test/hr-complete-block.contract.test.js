const fs=require('fs');const path=require('path');const read=(p)=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const {transitionReview,assessOffboardingReadiness,buildPolicyAcknowledgement,evaluateReviewClosure}=require('../services/business/hr-complete-block.service');
describe('bloc RH complet',()=>{
 test('le parcours historique, intégration, congés et compétences existe',()=>{const r=read('src/routes/business/hr.routes.js');for(const x of ['/employees','/onboarding','/leave-requests','/competencies','/alerts'])expect(r).toContain(x);expect(read('db/migrations/073_hr_transactional_core.sql')).toContain('ENABLE ROW LEVEL SECURITY');});
 test('les évaluations suivent un cycle contrôlé',()=>{expect(transitionReview('draft','employee_input')).toBe('employee_input');expect(()=>transitionReview('draft','closed')).toThrow();expect(evaluateReviewClosure({overallRating:4,objectives:[{}],competencies:[{}]}).complete).toBe(true);});
 test('les politiques sont versionnées et prouvables',()=>{expect(buildPolicyAcknowledgement({policyCode:'SEC',policyVersion:'2'})).toEqual(expect.objectContaining({policyCode:'SEC',policyVersion:'2'}));});
 test('un départ ne ferme qu après toutes les confirmations',()=>{expect(assessOffboardingReadiness({payrollConfirmed:true,accessRevoked:true,propertyReturned:true,documentsCompleted:true})).toEqual(expect.objectContaining({ready:true,status:'completed'}));expect(assessOffboardingReadiness({}).blockers).toHaveLength(4);});
 test('la fermeture ajoute évaluations politiques et départs avec RLS',()=>{const m=read('db/migrations/20260727240000_hr_complete_block_closure.sql');for(const x of ['hr_performance_reviews','hr_policy_acknowledgements','hr_offboarding_cases','ENABLE ROW LEVEL SECURITY'])expect(m).toContain(x);});
});
