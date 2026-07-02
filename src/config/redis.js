const Redis = require("ioredis");

function createNoopRedisClient() {
  const handlers = new Map();

  const client = {
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(cb);
      return client;
    },
    once(event, cb) {
      const wrapped = (...args) => {
        try {
          cb(...args);
        } finally {
          const set = handlers.get(event);
          if (set) set.delete(wrapped);
        }
      };
      return client.on(event, wrapped);
    },
    quit() {
      return Promise.resolve();
    },
    disconnect() {
      return Promise.resolve();
    },
    // Primitives commonly used in the codebase
    get() {
      return Promise.resolve(null);
    },
    set() {
      return Promise.resolve("OK");
    },
    del() {
      return Promise.resolve(0);
    },
    exists() {
      return Promise.resolve(0);
    },
    hget() {
      return Promise.resolve(null);
    },
    hset() {
      return Promise.resolve(0);
    },
    incr() {
      return Promise.resolve(0);
    },
    incrby() {
      return Promise.resolve(0);
    },
    publish() {
      return Promise.resolve(0);
    },
    subscribe() {
      return Promise.resolve();
    },
    unsubscribe() {
      return Promise.resolve();
    },
    psubscribe() {
      return Promise.resolve();
    },
    punsubscribe() {
      return Promise.resolve();
    },
    // Fallback: ne jamais planter les tests si une méthode n’est pas couverte
  };

  return new Proxy(client, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // méthodes inconnues -> no-op async
      return () => Promise.resolve(undefined);
    },
  });
}

const isTest = process.env.NODE_ENV === "test";
const redisDisabled = process.env.REDIS_DISABLED === "true";

let redis;
if (isTest || redisDisabled) {
  redis = createNoopRedisClient();
} else {
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

  redis.on("connect", () => {
    console.log("Redis connected");
  });

  redis.on("error", (err) => {
    console.error("Redis error:", err);
  });
}

module.exports = redis;
