// Backward-compatible export.
// The canonical implementation lives in organization.middleware.js and enforces:
// - authenticated organisation context
// - explicit transaction
// - SET LOCAL app.current_organisation_id
// - AsyncLocalStorage dbClient scoping for db.query
//
// Keep this file as a safe alias so older imports cannot bypass RLS.
module.exports = require("./organization.middleware").requireOrganisation;
