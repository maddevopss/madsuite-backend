const db = require("../../db");

const DEFAULT_TIMEZONE = "America/Montreal";
const SUPPORTED_TIMEZONES = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);

function normalizeTimezone(tz) {
  if (!tz || typeof tz !== "string") return DEFAULT_TIMEZONE;

  const value = tz.trim();

  if (value === "UTC" || SUPPORTED_TIMEZONES.has(value)) {
    return value;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
function getOrganisationId(req) {
  // Les routes applicatives doivent refuser explicitement les requêtes sans organisation.
  // Si on reçoit null/undefined, on force ensuite le scope à échouer (pas de fuite cross-org).
  return req.user?.organisation_id ?? null;
}

function organisationScope(alias, params, organisationId) {
  // Verrouillage SaaS : une requête métier ne doit JAMAIS être construite sans organisation.
  if (!organisationId) {
    const err = new Error(`OrganisationId requis pour appliquer le scope (${alias}.organisation_id).`);
    err.statusCode = 403;
    throw err;
  }

  params.push(organisationId);
  return `AND ${alias}.organisation_id = $${params.length}`;
}

function organisationValue(organisationId) {
  return organisationId ?? null;
}

async function getTimezone(organisationId) {
  if (!organisationId) return DEFAULT_TIMEZONE;

  try {
    const result = await db.query(`SELECT timezone FROM organisations WHERE id = $1`, [organisationId]);

    return normalizeTimezone(result.rows[0]?.timezone);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

module.exports = {
  DEFAULT_TIMEZONE,
  getOrganisationId,
  organisationScope,
  organisationValue,
  getTimezone,
  normalizeTimezone,
};
