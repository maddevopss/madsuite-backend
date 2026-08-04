/**
 * Contract Deprecation Middleware
 * Automatically adds deprecation headers to responses using deprecated contracts.
 * This middleware should be mounted early to inspect and modify response behavior.
 */

const { addDeprecationHeaders, isDeprecated } = require('../utils/contractVersioning');

/**
 * Middleware that hooks into response methods to add deprecation headers
 */
function contractDeprecationMiddleware() {
  return (req, res, next) => {
    // Store original json method
    const originalJson = res.json;

    // Override json method to intercept responses
    function jsonWithDeprecationHeaders(data) {
      try {
        // Check if response contains contract metadata
        if (data && typeof data === 'object' && data.meta && data.meta.contract) {
          const contractId = data.meta.contract;
          const [contractName, version] = contractId.split('@');

          // Add deprecation headers if contract is deprecated
          if (contractName && version) {
            try {
              if (isDeprecated(contractName, version)) {
                addDeprecationHeaders(res, contractName, version);
              }
            } catch {
              // Silently ignore unknown contracts - they're not in the registry
            }
          }
        }
      } catch {
        // Silently ignore any errors during header processing
      }

      // Call original json method
      return originalJson.call(res, data);
    }

    if (originalJson && originalJson.mock) {
      jsonWithDeprecationHeaders.mock = originalJson.mock;
    }

    res.json = jsonWithDeprecationHeaders;

    next();
  };
}

module.exports = contractDeprecationMiddleware;
