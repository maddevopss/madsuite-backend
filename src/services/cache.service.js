const NodeCache = require("node-cache");
const logger = require("../config/logger");

const cache = new NodeCache({
  stdTTL: 5 * 60, // 5 minutes default
  checkperiod: 60, // Check for expired every 60s
});

class CacheService {
  // Generate cache key from params, with optional organisation isolation
  static getCacheKey(type, params, organisationId = null) {
    const prefix = organisationId ? `org:${organisationId}:` : "";
    const key = `${prefix}${type}:${JSON.stringify(params)}`;
    return key.slice(0, 255); // Max key length
  }

  // Get with auto-expire
  static get(key) {
    const value = cache.get(key);
    if (value) {
      logger.debug(`[CACHE HIT] ${key}`);
      return value;
    }
    logger.debug(`[CACHE MISS] ${key}`);
    return null;
  }

  // Set with TTL
  static set(key, value, ttlSeconds = 300) {
    cache.set(key, value, ttlSeconds);
  }

  // Invalidate on data change, optionally scoped to an organisation
  static invalidate(pattern, organisationId = null) {
    const keys = cache.keys();
    const prefix = organisationId ? `org:${organisationId}:` : "";
    const fullPattern = prefix + pattern;
    
    keys
      .filter((k) => k.includes(fullPattern))
      .forEach((k) => {
        logger.debug(`[CACHE INVALIDATE] ${k}`);
        cache.del(k);
      });
  }

  // Clear all (use with caution, typically only for testing)
  static flush() {
    cache.flushAll();
  }

  // Get all keys (for debugging/monitoring)
  static getAllKeys() {
    return cache.keys();
  }
}

module.exports = CacheService;
