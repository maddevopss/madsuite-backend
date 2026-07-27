const fs=require('fs');const path=require('path');const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const {transitionInvestigation,assessInspectionClosure,assessTrainingCompliance,canCloseInvestigation}=require('../services/business/sst-complete-block.service');
describe('bloc SST complet',()=>{
 test('les parcours risques incidents inspections actions EPI et alertes existent',()=>{const r=read('src/routes/business/sst.routes.js');for(const x of ['/hazards','/incidents','/inspections','/corrective-actions','/ppe','/alerts'])expect(r).toContain(x);});
 test('une enquête ne ferme qu avec causes preuves et actions terminées',()=>{expect(transitionInvestigation('open','collecting')).toBe('collecting');expect(()=>transitionInvestigation('open','closed')).toThrow();expect(canCloseInvestigation({rootCauses:[{}],evidence:[{}],correctiveActions:[{status:'closed'}]}).ready).toBe(true);});
 test('une inspection critique non corrigée échoue',()=>{expect(assessInspectionClosure({completedChecklist:[{}],findings:[{severity:'critical'}]})).toEqual(expect.objectContaining({result:'fail',complete:false}));});
 test('la conformité de formation détecte les retards',()=>{expect(assessTrainingCompliance([{status:'assigned',dueAt:'2020-01-01'}]).overdue).toBe(1);});
 test('la fermeture ajoute enquêtes formations et clôtures avec RLS',()=>{const m=read('db/migrations/20260727241000_sst_complete_block_closure.sql');for(const x of ['sst_incident_investigations','sst_training_assignments','sst_inspection_closures','ENABLE ROW LEVEL SECURITY'])expect(m).toContain(x);});
});
