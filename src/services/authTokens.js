const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "1h";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "30d";

function parseDurationToMs(value, fallbackMs) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value || "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)?$/i);

  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  if (!Object.prototype.hasOwnProperty.call(multipliers, unit)) {
    return fallbackMs;
  }

  return Math.round(amount * multipliers[unit]);
}

const ACCESS_TOKEN_TTL_MS = parseDurationToMs(ACCESS_TOKEN_EXPIRES_IN, 60 * 60 * 1000);
const REFRESH_TOKEN_TTL_MS = parseDurationToMs(REFRESH_TOKEN_EXPIRES_IN, 30 * 24 * 60 * 60 * 1000);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createTokenPayload(user, sessionId, tokenType) {
  return {
    id: user.id,
    role: user.role,
    organisation_id: user.organisation_id ?? null,
    session_id: sessionId,
    token_type: tokenType,
  };
}

function createAccessToken(user, sessionId) {
  return jwt.sign(createTokenPayload(user, sessionId, "access"), process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    algorithm: "HS256",
  });
}

function createRefreshToken(user, sessionId) {
  return jwt.sign(createTokenPayload(user, sessionId, "refresh"), process.env.JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    algorithm: "HS256",
    jwtid: crypto.randomUUID(),
  });
}

function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
  });
}

module.exports = {
  ACCESS_TOKEN_EXPIRES_IN,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_TTL_MS,
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyJwt,
};
