const cors = require("cors");

const isProd = process.env.NODE_ENV === "production";

// En production : whitelist STRICTE.
// En dev/test : on autorise localhost par confort.
const allowedOrigins = [
  ...(isProd
    ? []
    : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:5000", "http://127.0.0.1:5000"]),
  process.env.FRONTEND_URL,       // ex: https://madsuite.ca
  process.env.ELECTRON_URL,
  // Domaines Vercel (production + previews)
  "https://madsuite.vercel.app",
  process.env.VERCEL_FRONTEND_URL, // URL preview spécifique si nécessaire
].filter(Boolean);

const corsConfig = cors({
  origin(origin, callback) {
    // Non-browser requests: autoriser.
    if (!origin) return callback(null, true);

    if (!allowedOrigins.includes(origin)) {
      return callback(new Error(`CORS refusé pour origine: ${origin}`));
    }

    return callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

module.exports = corsConfig;
