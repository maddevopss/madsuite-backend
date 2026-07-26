'use strict';

const REQUIRED_FIELDS = ['id', 'name', 'owner', 'purpose', 'source', 'consumers', 'schemaVersion', 'organisationScope', 'environment'];

function validateDataAsset(asset) {
  if (!asset || typeof asset !== 'object') throw new TypeError('data asset is required');
  for (const field of REQUIRED_FIELDS) {
    const value = asset[field];
    if (value === undefined || value === null || value === '') throw new Error(`missing data asset field: ${field}`);
  }
  if (!Array.isArray(asset.consumers)) throw new TypeError('consumers must be an array');
  return Object.freeze({ ...asset, consumers: [...asset.consumers] });
}

function buildDataCatalog(assets) {
  if (!Array.isArray(assets)) throw new TypeError('assets must be an array');
  const catalog = new Map();
  for (const asset of assets.map(validateDataAsset)) {
    if (catalog.has(asset.id)) throw new Error(`duplicate data asset: ${asset.id}`);
    catalog.set(asset.id, asset);
  }
  return catalog;
}

module.exports = { REQUIRED_FIELDS, validateDataAsset, buildDataCatalog };
