const fs=require('fs');const path=require('path');const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const {transitionApproval,assessDisposition,buildAccessEvent,canPublishVersion}=require('../services/business/document-management-complete-block.service');
describe('bloc gestion documentaire complet',()=>{
 test('les dossiers versions liens et alertes existent',()=>{const r=read('src/routes/business/document-proof.routes.js');for(const x of ['/records','/versions','/links','/alerts'])expect(r).toContain(x);});
 test('une version exige les approbations requises',()=>{expect(transitionApproval('pending','approved')).toBe('approved');expect(()=>transitionApproval('approved','rejected')).toThrow();expect(canPublishVersion({requiredApprovals:2,approvals:[{status:'approved'},{status:'approved'}]}).publishable).toBe(true);});
 test('les accès sensibles sont journalisés',()=>{expect(buildAccessEvent({documentId:1,action:'download'})).toEqual(expect.objectContaining({documentId:1,action:'download'}));expect(()=>buildAccessEvent({documentId:1,action:'erase'})).toThrow();});
 test('une conservation ou un gel juridique bloque la destruction',()=>{expect(assessDisposition({legalHoldDetected:true,rationale:'fin'}).allowed).toBe(false);expect(assessDisposition({retentionDueAt:'2099-01-01',now:'2026-01-01',rationale:'fin'}).blockers).toContain('retentionNotDue');});
 test('la fermeture ajoute approbations accès et dispositions avec RLS',()=>{const m=read('db/migrations/20260727242000_document_management_complete_block.sql');for(const x of ['document_approvals','document_access_events','document_disposition_cases','ENABLE ROW LEVEL SECURITY'])expect(m).toContain(x);});
});
