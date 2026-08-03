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
    const originalJson = res.json.bind(res);

    // Override json method to intercept responses
    res.json = function (data) {
      // Check if response contains contract metadata
      if (data && typeof data === 'object' && data.meta && data.meta.contract) {
        const contractId = data.meta.contract;
        const [contractName, version] = contractId.split('@');

        // Add deprecation headers if contract is deprecated
        if (contractName && isDeprecated(contractName, version)) {
          addDeprecationHeaders(res, contractName, version);
        }
      }

      // Call original json method
      return originalJson(data);
    };

    next();
  };
}

module.exports = contractDeprecationMiddleware;
