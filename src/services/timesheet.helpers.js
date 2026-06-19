function requireOrganisation(organisationId) {
  if (!organisationId) {
    const err = new Error("Aucune organisation associ\u00e9e \u00e0 cet utilisateur.");
    err.statusCode = 403;
    throw err;
  }
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function getDeletedFilters() {
  return {
    clientFilter: "AND c.deleted_at IS NULL",
    projectFilter: "AND p.deleted_at IS NULL",
    timeEntryFilter: "AND te.deleted_at IS NULL",
  };
}

module.exports = {
  addParam,
  getDeletedFilters,
  requireOrganisation,
};
