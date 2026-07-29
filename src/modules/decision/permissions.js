const ROLE_SCOPES = {
  admin: ['financial', 'operations', 'people', 'clients'],
  manager: ['operations', 'clients'],
  employee: ['self'],
};

function canReadScope(role, scope) {
  return (ROLE_SCOPES[role] || []).includes(scope);
}

module.exports = { ROLE_SCOPES, canReadScope };
