const NodeCache = require("node-cache");
const logger = require("../config/logger");

const cache = new NodeCache({
  stdTTL: 5 * 60, // 5 minutes default
  checkperiod: 60, // Check for expired every 60s
});

class CacheService {
  // Generate cache key from params
  static getCacheKey(type, params) {
    const key = `${type}:${JSON.stringify(params)}`;
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

  // Invalidate on data change
  static invalidate(pattern) {
    const keys = cache.keys();
    keys.filter((k) => k.includes(pattern)).forEach((k) => cache.del(k));
  }

  // Clear all
  static flush() {
    cache.flushAll();
  }
}

module.exports = CacheService;
