function assertSameOrganisation({ actorOrganisationId, resourceOrganisationId, referencedOrganisationIds = [] }) {
  const actor = String(actorOrganisationId || '');
  const observed = [resourceOrganisationId, ...referencedOrganisationIds].filter((value) => value !== null && value !== undefined).map(String);
  const foreign = observed.filter((value) => value !== actor);
  if (!actor || foreign.length) {
    const error = new Error('Référence inter-organisation interdite.');
    error.code = 'tenant.cross_reference_forbidden';
    error.details = { foreignCount: foreign.length };
    throw error;
  }
  return { contract: 'tenant-isolation-proof@1', organisationId: actor, isolated: true };
}

module.exports = { assertSameOrganisation };