const bcrypt = require("bcrypt");
const db = require("../../db");
const { hasColumn } = require("../utils/dbSchema");
const {
  ACCESS_TOKEN_EXPIRES_IN,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_TTL_MS,
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyJwt,
} = require("./authTokens");

async function findUserByEmail(email) {
  const result = await db.query(
    `
    SELECT id, nom, email, mot_de_passe, role, organisation_id, deleted_at
    FROM utilisateurs
    WHERE email = $1
      AND deleted_at IS NULL
    `,
    [email],
  );

  return result.rows[0] || null;
}

async function findUserById(client, userId) {
  const result = await client.query(
    `
    SELECT id, nom, email, role, organisation_id, deleted_at
    FROM utilisateurs
    WHERE id = $1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function createAuthSession(client, user, req) {
  const sessionResult = await client.query(
    `
    INSERT INTO user_sessions (utilisateur_id, organisation_id, ip_address)
    VALUES ($1, $2, $3)
    RETURNING id
    `,
    [user.id, user.organisation_id, req.ip || null],
  );

  const sessionId = sessionResult.rows[0].id;
  const accessToken = createAccessToken(user, sessionId);
  const refreshToken = createRefreshToken(user, sessionId);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await client.query(
    `
    INSERT INTO refresh_tokens (
      utilisateur_id,
      session_id,
      token_hash,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [user.id, sessionId, hashToken(refreshToken), expiresAt, req.ip || null, req.get("user-agent") || null],
  );

  return {
    accessToken,
    refreshToken,
    sessionId,
  };
}

async function loginUser({ email, password, req }) {
  const user = await findUserByEmail(email);

  if (!user) {
    const err = new Error("Utilisateur invalide");
    err.statusCode = 401;
    throw err;
  }

  const validPassword = await bcrypt.compare(password, user.mot_de_passe);

  if (!validPassword) {
    const err = new Error("Mot de passe invalide");
    err.statusCode = 401;
    throw err;
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const session = await createAuthSession(client, user, req);

    if (await hasColumn("utilisateurs", "last_login_at", client)) {
      await client.query(
        `
        UPDATE utilisateurs
        SET last_login_at = NOW()
        WHERE id = $1
        `,
        [user.id],
      );
    }

    await client.query("COMMIT");

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        organisation_id: user.organisation_id ?? null,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function rotateRefreshToken(client, user, sessionId, currentToken, req) {
  const currentTokenHash = hashToken(currentToken);

  const result = await client.query(
    `
    SELECT
      rt.id,
      rt.utilisateur_id,
      rt.session_id,
      rt.revoked_at,
      rt.expires_at,
      u.nom,
      u.email,
      u.role,
      u.organisation_id,
      u.deleted_at,
      us.active AS session_active
    FROM refresh_tokens rt
    INNER JOIN utilisateurs u ON u.id = rt.utilisateur_id
    INNER JOIN user_sessions us ON us.id = rt.session_id
    WHERE rt.token_hash = $1
    FOR UPDATE
    `,
    [currentTokenHash],
  );

  const storedToken = result.rows[0];

  if (
    !storedToken ||
    storedToken.revoked_at ||
    new Date(storedToken.expires_at).getTime() <= Date.now() ||
    storedToken.deleted_at ||
    storedToken.session_active !== true ||
    Number(storedToken.utilisateur_id) !== Number(user.id) ||
    Number(storedToken.session_id) !== Number(sessionId)
  ) {
    return null;
  }

  const nextRefreshToken = createRefreshToken(user, sessionId);
  const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const inserted = await client.query(
    `
    INSERT INTO refresh_tokens (
      utilisateur_id,
      session_id,
      token_hash,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    `,
    [user.id, sessionId, hashToken(nextRefreshToken), nextExpiresAt, req.ip || null, req.get("user-agent") || null],
  );

  await client.query(
    `
    UPDATE refresh_tokens
    SET revoked_at = NOW(),
        replaced_by_token_id = $2
    WHERE id = $1
    `,
    [storedToken.id, inserted.rows[0].id],
  );

  return {
    accessToken: createAccessToken(user, sessionId),
    refreshToken: nextRefreshToken,
  };
}

async function refreshSession({ refreshToken, req }) {
  let decoded;

  try {
    decoded = verifyJwt(refreshToken);

    if (decoded.token_type !== "refresh") {
      const err = new Error("Refresh token invalide ou expiré");
      err.statusCode = 401;
      throw err;
    }
  } catch {
    const err = new Error("Refresh token invalide ou expiré");
    err.statusCode = 401;
    throw err;
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const user = await findUserById(client, decoded.id);

    if (!user || user.deleted_at) {
      await client.query("ROLLBACK");

      const err = new Error("Refresh token invalide ou expiré");
      err.statusCode = 401;
      throw err;
    }

    const rotated = await rotateRefreshToken(client, user, decoded.session_id, refreshToken, req);

    if (!rotated) {
      await client.query("ROLLBACK");

      const err = new Error("Refresh token invalide ou expiré");
      err.statusCode = 401;
      throw err;
    }

    await client.query("COMMIT");

    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        organisation_id: user.organisation_id ?? null,
      },
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback error.
    }

    throw err;
  } finally {
    client.release();
  }
}

function getSessionIdFromAccessToken(token) {
  if (!token) return null;

  try {
    const decoded = verifyJwt(token);
    return decoded.token_type === "access" ? decoded.session_id || null : null;
  } catch {
    return null;
  }
}

async function getSessionIdFromRefreshToken(client, refreshToken) {
  if (!refreshToken) return null;

  const result = await client.query(
    `
    SELECT session_id
    FROM refresh_tokens
    WHERE token_hash = $1
    LIMIT 1
    FOR UPDATE
    `,
    [hashToken(refreshToken)],
  );

  return result.rows[0]?.session_id || null;
}

async function logoutSession({ token, refreshToken }) {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const sessionId = getSessionIdFromAccessToken(token) || (await getSessionIdFromRefreshToken(client, refreshToken));

    if (!sessionId) {
      await client.query("COMMIT");
      return true;
    }

    await client.query(
      `
      UPDATE user_sessions
      SET logout_time = NOW(),
          active = false,
          duration_seconds = EXTRACT(EPOCH FROM (NOW() - login_time))::int
      WHERE id = $1
      `,
      [sessionId],
    );

    await client.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE session_id = $1
        AND revoked_at IS NULL
      `,
      [sessionId],
    );

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function signupUser({ organisation_nom, user_nom, email, password, req }) {
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    const err = new Error("Un compte existe déjà avec cette adresse email.");
    err.statusCode = 409;
    throw err;
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Create organisation with a 14-day trial
    const orgResult = await client.query(
      `
      INSERT INTO organisations (nom, trial_ends_at)
      VALUES ($1, NOW() + INTERVAL '14 days')
      RETURNING id, nom
      `,
      [organisation_nom]
    );

    const organisation = orgResult.rows[0];

    // 2. Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Create user
    const userResult = await client.query(
      `
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, organisation_id, role_org)
      VALUES ($1, $2, $3, 'admin', $4, 'admin')
      RETURNING id, nom, email, role, organisation_id
      `,
      [user_nom, email, passwordHash, organisation.id]
    );

    const user = userResult.rows[0];

    // 4. Create session
    const session = await createAuthSession(client, user, req);

    await client.query("COMMIT");

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        organisation_id: user.organisation_id,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ACCESS_TOKEN_EXPIRES_IN,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_TTL_MS,
  loginUser,
  signupUser,
  refreshSession,
  logoutSession,
};
