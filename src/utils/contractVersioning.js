/**
 * Contract Versioning & Deprecation Management
 * Manages contract versions, deprecation periods, and backward compatibility.
 */

const CONTRACT_VERSIONS = {
  'integration-list': {
    current: '1',
    versions: {
      '1': {
        deprecated: false,
        sunset: null,
        replacedBy: null,
        releaseDate: '2024-06-01',
      },
    },
  },
  'integration-resource': {
    current: '1',
    versions: {
      '1': {
        deprecated: false,
        sunset: null,
        replacedBy: null,
        releaseDate: '2024-06-01',
      },
    },
  },
  'server-capabilities': {
    current: '1',
    versions: {
      '1': {
        deprecated: false,
        sunset: null,
        replacedBy: null,
        releaseDate: '2024-06-15',
      },
    },
  },
  'transition': {
    current: '1',
    versions: {
      '1': {
        deprecated: false,
        sunset: null,
        replacedBy: null,
        releaseDate: '2024-07-01',
      },
    },
  },
  'block-closure': {
    current: '1',
    versions: {
      '1': {
        deprecated: false,
        sunset: null,
        replacedBy: null,
        releaseDate: '2026-08-03',
      },
    },
  },
};

/**
 * Get contract version metadata
 */
function getContractVersion(name, version = null) {
  const contract = CONTRACT_VERSIONS[name];
  if (!contract) {
    throw new Error(`Contract '${name}' not found`);
  }

  const versionKey = version || contract.current;
  const versionInfo = contract.versions[versionKey];

  if (!versionInfo) {
    throw new Error(`Contract version '${name}@${versionKey}' not found`);
  }

  return {
    name,
    version: versionKey,
    ...versionInfo,
    contractId: `${name}@${versionKey}`,
  };
}

/**
 * Check if contract version is deprecated
 */
function isDeprecated(name, version = null) {
  const info = getContractVersion(name, version);
  return info.deprecated === true;
}

/**
 * Add deprecation headers to response
 */
function addDeprecationHeaders(res, contractName, version = null) {
  try {
    const info = getContractVersion(contractName, version);

    if (info.deprecated) {
      res.set('Deprecation', 'true');

      if (info.sunset) {
        res.set('Sunset', new Date(info.sunset).toUTCString());
      }

      if (info.replacedBy) {
        res.set('Link', `<${info.replacedBy}>; rel="successor-version"`);
      }

      // Custom header for MADSuite API clients
      res.set('X-Contract-Deprecated', info.contractId);
    }
  } catch (err) {
    // Silently ignore if contract not found (shouldn't happen)
  }
}

/**
 * Format response with contract metadata
 */
function withContractMeta(data, contractName, version = null) {
  const info = getContractVersion(contractName, version);

  return {
    ...data,
    meta: {
      ...(data.meta || {}),
      contract: info.contractId,
      deprecated: info.deprecated,
      ...(info.sunset && { sunset: info.sunset }),
      ...(info.replacedBy && { replacedBy: info.replacedBy }),
    },
  };
}

/**
 * Create contract adapter for version conversion
 * Converts old contract format to new format or vice versa
 */
function createContractAdapter(fromVersion, toVersion) {
  return function adapt(data) {
    // Default: no conversion needed if versions are compatible
    // This will be extended as incompatible versions are introduced
    return data;
  };
}

/**
 * List all available contracts and their versions
 */
function listContracts() {
  const result = {};

  for (const [name, info] of Object.entries(CONTRACT_VERSIONS)) {
    result[name] = {
      current: info.current,
      versions: Object.keys(info.versions).sort().reverse(),
      metadata: info.versions,
    };
  }

  return result;
}

/**
 * Declare new contract version (for future use)
 */
function registerContractVersion(name, version, metadata = {}) {
  if (!CONTRACT_VERSIONS[name]) {
    CONTRACT_VERSIONS[name] = { current: version, versions: {} };
  }

  CONTRACT_VERSIONS[name].versions[version] = {
    deprecated: false,
    sunset: null,
    replacedBy: null,
    releaseDate: new Date().toISOString().split('T')[0],
    ...metadata,
  };

  // Update current if this is a newer version
  if (String(version) > String(CONTRACT_VERSIONS[name].current)) {
    CONTRACT_VERSIONS[name].current = version;
  }
}

/**
 * Deprecate contract version
 */
function deprecateContractVersion(name, version, { sunsetDate, replacedBy } = {}) {
  const info = getContractVersion(name, version);

  info.deprecated = true;
  if (sunsetDate) {
    info.sunset = new Date(sunsetDate).toISOString();
  }
  if (replacedBy) {
    info.replacedBy = replacedBy;
  }
}

module.exports = {
  CONTRACT_VERSIONS,
  getContractVersion,
  isDeprecated,
  addDeprecationHeaders,
  withContractMeta,
  createContractAdapter,
  listContracts,
  registerContractVersion,
  deprecateContractVersion,
};
