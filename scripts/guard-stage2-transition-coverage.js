const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceRoots = ['src/services/business', 'src/routes/business', 'src/test'].map((entry) => path.join(root, entry));

const stage2Transitions = [
  { policy: 'risk.control.transition@1', route: 'src/routes/business/enterprise-risk.routes.js', markers: ["router.post('/controls/:id/transition'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'risk.treatment.transition@1', route: 'src/routes/business/enterprise-risk.routes.js', markers: ["router.post('/treatments/:id/transition'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'risk.review.transition@1', route: 'src/routes/business/enterprise-risk.routes.js', markers: ["router.post('/reviews/:id/transition'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'cybersecurity.vulnerability.transition@1', route: 'src/routes/business/cybersecurity-governance.routes.js', markers: ["router.post('/vulnerabilities/:id/transition'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'audit.engagement.complete@1', route: 'src/routes/business/internal-audit.routes.js', markers: ["router.post('/engagements/:id/complete'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'audit.action.transition@1', route: 'src/routes/business/internal-audit.routes.js', markers: ["router.post('/actions/:id/transition'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'audit.finding.close@1', route: 'src/routes/business/internal-audit.routes.js', markers: ["router.post('/findings/:id/close'", 'openActionsCount', 'evaluatePolicy'] },
  { policy: 'governance.committee.meeting.complete@1', route: 'src/routes/business/organizational-governance.routes.js', markers: ["router.post('/meetings/:id/complete'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'governance.policy.publish@1', route: 'src/routes/business/organizational-governance.routes.js', markers: ["router.post('/policies/:id/publish'", 'FOR UPDATE', 'evaluatePolicy'] },
  { policy: 'governance.authority.validate@1', route: 'src/routes/business/organizational-governance.routes.js', markers: ["router.post('/authority/validate'", 'resolveAuthority', 'evaluatePolicy'] },
  { policy: 'governance.decision.approve@1', route: 'src/routes/business/organizational-governance.routes.js', markers: ["router.post('/decisions/:id/approve'", 'resolveAuthority', 'evaluatePolicy'] },
  { policy: 'finance.budget.approve@1', route: 'src/routes/business/advanced-financial-management.routes.js', markers: ["router.post('/budgets/:id/approve'", 'FOR UPDATE', 'evaluatePolicy'] },
  { policy: 'finance.forecast.publish@1', route: 'src/routes/business/advanced-financial-management.routes.js', markers: ["router.post('/forecasts/:id/publish'", 'FOR UPDATE', 'evaluatePolicy'] },
  { policy: 'finance.scenario.approve@1', route: 'src/routes/business/advanced-financial-management.routes.js', markers: ["router.post('/scenarios/:id/approve'", 'FOR UPDATE', 'evaluatePolicy'] },
  { policy: 'documents.document.publish@1', route: 'src/routes/business/advanced-document-governance.routes.js', markers: ["router.post('/documents/:id/publish'", 'FOR UPDATE', 'evaluatePolicy'] },
  { policy: 'documents.retention.execute@1', route: 'src/routes/business/advanced-document-governance.routes.js', markers: ["router.post('/retention-actions/:id/execute'", 'FOR UPDATE', 'evaluatePolicy'] },
  { policy: 'facilities.asset.decommission@1', route: 'src/routes/business/facilities-management.routes.js', markers: ["router.post('/assets/:id/decommission'", 'FOR UPDATE', 'executeTransaction'] },
  { policy: 'performance.objective.approve@1', route: 'src/routes/business/organizational-performance.routes.js', markers: ["router.post('/objectives/:id/approve'", 'FOR UPDATE', 'evaluatePolicy'] },
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function registeredPolicyRefs(files) {
  const refs = new Set();
  const pattern = /registerPolicy\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
  for (const filePath of files) {
    const source = read(filePath);
    let match = pattern.exec(source);
    while (match) {
      refs.add(`${match[1]}@${match[2]}`);
      match = pattern.exec(source);
    }
  }
  return refs;
}

function hasReference(source, policy) {
  const [name] = policy.split('@');
  return source.includes(policy) || source.includes(`'${name}'`) || source.includes(`"${name}"`);
}

function inspectStage2TransitionCoverage() {
  const files = sourceRoots.flatMap(walk);
  const registrations = registeredPolicyRefs(files);
  const allSource = files.map(read).join('\n');
  const testSource = walk(path.join(root, 'src/test')).map(read).join('\n');

  return stage2Transitions.map((transition) => {
    const routePath = path.join(root, transition.route);
    const routeSource = fs.existsSync(routePath) ? read(routePath) : '';
    const missingMarkers = transition.markers.filter((marker) => !routeSource.includes(marker));
    return {
      ...transition,
      registered: registrations.has(transition.policy),
      referenced: hasReference(routeSource || allSource, transition.policy),
      tested: hasReference(testSource, transition.policy),
      routeExists: Boolean(routeSource),
      missingMarkers,
    };
  });
}

function failures(report = inspectStage2TransitionCoverage()) {
  return report.filter((item) => !item.registered || !item.referenced || !item.tested || !item.routeExists || item.missingMarkers.length > 0);
}

if (require.main === module) {
  const report = inspectStage2TransitionCoverage();
  const failed = failures(report);
  if (failed.length > 0) {
    console.error(JSON.stringify({ ok: false, failed }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, checked: report.length, policies: report.map((item) => item.policy) }, null, 2));
  }
}

module.exports = { stage2Transitions, inspectStage2TransitionCoverage, failures };
