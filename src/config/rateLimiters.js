const rateLimit = require("express-rate-limit");

const isTest = process.env.NODE_ENV === "test";
const isDev = process.env.NODE_ENV === "development";

const skipInTest = () => isTest;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 20,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Trop de tentatives de connexion, réessaie plus tard.",
  },
});

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 500,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many requests, please try again later.",
  },
});

const activityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 2000 : 240,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many activity requests, please try again later.",
  },
});

module.exports = {
  loginLimiter,
  defaultLimiter,
  activityLimiter,
};
