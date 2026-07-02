const crypto = require("crypto");
const pool = require ("../config/db.js");
const { z } = require ("zod");


function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function createResetToken(
  userId,
  tokenHash,
  expiresAt
) {
  return pool.query(
    `
    INSERT INTO password_reset_tokens (
      user_id,
      token_hash,
      expires_at
    )
    VALUES ($1,$2,$3)
    `,
    [userId, tokenHash, expiresAt]
  );
}

function findToken(tokenHash) {
  return pool.query(
    `
    SELECT *
    FROM password_reset_tokens
    WHERE token_hash = $1
    LIMIT 1
    `,
    [tokenHash]
  );
}

function invalidateUserTokens(userId) {
  return pool.query(
    `
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE user_id = $1
      AND used_at IS NULL
    `,
    [userId]
  );
}

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(12)
});

module.exports = {
  hashToken,
  createResetToken,
  findToken,
  invalidateUserTokens
};
