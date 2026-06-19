function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const BCRYPT_SALT_ROUNDS =
  process.env.NODE_ENV === "production"
    ? readPositiveInt(process.env.BCRYPT_SALT_ROUNDS, 12)
    : readPositiveInt(process.env.BCRYPT_SALT_ROUNDS, 10);

module.exports = {
  BCRYPT_SALT_ROUNDS,
};


function csvEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildContentSecurityPolicy() {
  const isProd = process.env.NODE_ENV === "production";

  const devConnectSrc = isProd ? [] : ["http://localhost:5000", "http://127.0.0.1:5000", "ws://localhost:3000"];
  const extraConnectSrc = csvEnv("CSP_CONNECT_SRC");
  const extraImgSrc = csvEnv("CSP_IMG_SRC");
  const extraFrameAncestors = csvEnv("CSP_FRAME_ANCESTORS");

  return {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:", ...extraImgSrc],
      "connect-src": ["'self'", ...devConnectSrc, process.env.FRONTEND_URL, process.env.ELECTRON_URL, ...extraConnectSrc].filter(Boolean),
      "font-src": ["'self'", "data:"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-ancestors": extraFrameAncestors.length ? extraFrameAncestors : ["'self'"],
    },
  };
}

module.exports.buildContentSecurityPolicy = buildContentSecurityPolicy;
