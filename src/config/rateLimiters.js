const rateLimit = require("express-rate-limit");
const OrganisationStore = require("./orgRateLimitStore");

const isTest = process.env.NODE_ENV === "test";
const isDev = process.env.NODE_ENV === "development";

const skipInTest = () => isTest;
// Custom keyGenerator that uses organisationId
const { ipKeyGenerator } = require("express-rate-limit");

const orgKeyGenerator = (req) => {
  try {
    if (req.organisationId) return `org:${req.organisationId}`;
    return ipKeyGenerator(req) || req.ip;
  } catch (e) {
    return req.ip || "unknown";
  }
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 20,
  skip: skipInTest,
  keyGenerator: orgKeyGenerator, // 👈 ajoute ça
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Trop de tentatives de connexion, réessaie plus tard.",
  },
});

const activityLimiter = rateLimit({
  store: new OrganisationStore(),
  windowMs: 60 * 1000,
  max: isDev ? 2000 : 500, // 500 reqs/min PER ORG
  skip: skipInTest,
  keyGenerator: orgKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Organisation quota exceeded. Try again in 1 minute.",
  },
});

const defaultLimiter = rateLimit({
  store: new OrganisationStore(),
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 1000, // 1000 reqs/15min PER ORG
  skip: skipInTest,
  keyGenerator: orgKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  defaultLimiter,
  activityLimiter,
};
