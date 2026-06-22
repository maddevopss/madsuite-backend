function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function getOrganisationId(req) {
  return req.user?.organisation_id || null;
}

function appendOrganisationScope(params, organisationId, column = "organisation_id") {
  if (organisationId) {
    params.push(organisationId);
    return `(${column} = $${params.length} OR ${column} IS NULL)`;
  }

  return `${column} IS NULL`;
}

function buildFeedbackKeyword(windowTitle) {
  const keyword = String(windowTitle || "")
    .split(/[—\-|]/)[0]
    .trim()
    .slice(0, 255);

  return keyword.length >= 3 ? keyword : null;
}

module.exports = {
  normalize,
  getOrganisationId,
  appendOrganisationScope,
  buildFeedbackKeyword,
};
