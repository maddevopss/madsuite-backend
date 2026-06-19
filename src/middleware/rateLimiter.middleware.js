// backend/src/middleware/rateLimiter.middleware.js
// Rate limiting middleware using express-rate-limit
// Limits auth routes to mitigate credential stuffing attacks.
// Adjust limits as needed for production.

const rateLimit = require('express-rate-limit');

// Basic limiter: max 5 requests per minute per IP
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: 'Too many attempts, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,
});

module.exports = authRateLimiter;
