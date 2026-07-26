'use strict';

function publishCatalogEntry(extension) {
  const required = ['id', 'name', 'version', 'publisherId', 'license', 'compatibility', 'certificationLevel'];
  for (const field of required) {
    if (!extension?.[field]) throw new Error(`catalog.${field} is required`);
  }
  return Object.freeze({
    id: extension.id,
    name: extension.name,
    version: extension.version,
    publisherId: extension.publisherId,
    license: extension.license,
    compatibility: extension.compatibility,
    capabilities: [...new Set(extension.capabilities || [])],
    certificationLevel: extension.certificationLevel,
    history: extension.history || [],
    installable: extension.state === 'active' && extension.certificationLevel !== 'community_unreviewed',
  });
}

function authorizeCatalogInstallation({ entry, consent, organisationId }) {
  if (!entry?.installable) return { allowed: false, reason: 'extension_not_installable' };
  if (!consent?.explicit || consent.organisationId !== organisationId) return { allowed: false, reason: 'explicit_consent_required' };
  return { allowed: true, consentId: consent.id };
}

module.exports = { publishCatalogEntry, authorizeCatalogInstallation };
