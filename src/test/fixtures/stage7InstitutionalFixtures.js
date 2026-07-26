const organisations = [
  { id: 'org-alpha', name: 'Atelier Alpha' },
  { id: 'org-beta', name: 'Bureau Beta' },
];

const users = [
  { id: 'u-alpha-member', organisationId: 'org-alpha', role: 'member' },
  { id: 'u-alpha-admin', organisationId: 'org-alpha', role: 'admin' },
  { id: 'u-beta-admin', organisationId: 'org-beta', role: 'admin' },
];

const records = [
  { id: 'risk-alpha-1', organisationId: 'org-alpha', type: 'risk', status: 'open', evidence: ['fixture://risk-alpha-1'] },
  { id: 'incident-alpha-1', organisationId: 'org-alpha', type: 'incident', status: 'contained', evidence: ['fixture://incident-alpha-1'] },
  { id: 'audit-beta-1', organisationId: 'org-beta', type: 'audit', status: 'review', evidence: ['fixture://audit-beta-1'] },
];

function buildStage7Fixtures() {
  return JSON.parse(JSON.stringify({ contract: 'stage7-fixtures@1', organisations, users, records }));
}

module.exports = { buildStage7Fixtures };
