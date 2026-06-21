/**
 * Custom store that keys on organisationId instead of IP
 * Allows each org independent quota
 */
class OrganisationStore {
  constructor() {
    this.hits = new Map(); // org_id -> { count, resetTime }
    this.windowMs = 60000; // default
    this.cleanup();
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  // Cleanup old entries every minute
  cleanup() {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.hits.entries()) {
        if (data.resetTime < now) {
          this.hits.delete(key);
        }
      }
    }, 60000);
    if (interval.unref) {
      interval.unref();
    }
  }

  async increment(key) {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetTime < now) {
      // New window
      const resetTime = new Date(now + this.windowMs);
      this.hits.set(key, { count: 1, resetTime: resetTime.getTime() });
      return { totalHits: 1, resetTime };
    }

    // Increment existing
    entry.count++;
    return { totalHits: entry.count, resetTime: new Date(entry.resetTime) };
  }

  decrement(key) {
    const entry = this.hits.get(key);
    if (entry) {
      entry.count = Math.max(0, entry.count - 1);
    }
  }

  resetKey(key) {
    this.hits.delete(key);
  }
}

module.exports = OrganisationStore;
