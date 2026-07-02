const bcrypt = require("bcrypt");
const db = require("../../db");
const { BCRYPT_SALT_ROUNDS } = require("../config/security");

function duplicateEmailError() {
  const err = new Error("Cet email existe deja.");
  err.statusCode = 409;
  return err;
}

function notFoundError() {
  const err = new Error("Utilisateur introuvable.");
  err.statusCode = 404;
  return err;
}

function requirePassword(rawPassword, message) {
  if (!rawPassword) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }
}

async function listUsers({ organisationId }) {
  const result = await db.query(
    `SELECT u.id, u.nom, u.email, u.role, u.is_kiosk_user, u.created_at,
            o.kiosk_token
     FROM utilisateurs u
     LEFT JOIN organisations o ON o.id = u.organisation_id
     WHERE u.deleted_at IS NULL
       AND u.organisation_id = $1
     ORDER BY u.id DESC`,
    [organisationId],
  );

  return result.rows.map((row) => {
    const { kiosk_token, ...rest } = row;
    const base = kiosk_token ? `/kiosk/${kiosk_token}` : null;
    return {
      ...rest,
      kiosk_url: rest.is_kiosk_user && base ? `${base}?u=${rest.id}` : null,
    };
  });
}

async function createUser({ data, organisationId }) {
  const { nom, email, password, mot_de_passe: motDePasse, role = "employe", is_kiosk_user = false, pin } = data;
  
  let rawPassword = password || motDePasse;
  let finalEmail = email;

  if (is_kiosk_user) {
    if (!rawPassword) rawPassword = require("crypto").randomBytes(16).toString("hex");
    if (!finalEmail) finalEmail = `kiosk_${Date.now()}_${Math.floor(Math.random()*1000)}@kiosk.local`;
  }

  requirePassword(rawPassword, "Mot de passe requis.");

  const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_SALT_ROUNDS);
  let pinHash = null;
  if (is_kiosk_user && pin) {
    pinHash = await bcrypt.hash(pin, BCRYPT_SALT_ROUNDS);
  }

  try {
    const result = await db.query(
      `INSERT INTO utilisateurs (
         nom,
         email,
         mot_de_passe,
         role,
         is_kiosk_user,
         pin_hash,
         organisation_id,
         deleted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       RETURNING id, nom, email, role, is_kiosk_user, created_at`,
      [nom, finalEmail, hashedPassword, role, is_kiosk_user, pinHash, organisationId],
    );

    const created = result.rows[0];
    if (created && created.is_kiosk_user) {
      const tokenRes = await db.query(
        `SELECT FROM organisations WHERE id = $1`,
        [organisationId]
      );
      const kioskToken = tokenRes.rows[0]?.kiosk_token;
      if (kioskToken) {
        created.kiosk_url = `/kiosk/${kioskToken}?u=${created.id}`;
      }
    }
    return created;
  } catch (err) {
    if (err.code === "23505") {
      throw duplicateEmailError();
    }

    throw err;
  }
}

async function updateUser({ userId, data, organisationId }) {
  const { nom, email, role, is_kiosk_user, pin } = data;
  
  let pinHashUpdateStr = "";
  let queryParams = [nom, email, role, userId, organisationId];
  
  if (is_kiosk_user !== undefined) {
    pinHashUpdateStr += `, is_kiosk_user = COALESCE($6, is_kiosk_user)`;
    queryParams.push(is_kiosk_user);
  }
  
  if (pin) {
    const pinHash = await bcrypt.hash(pin, BCRYPT_SALT_ROUNDS);
    queryParams.push(pinHash);
    pinHashUpdateStr += `, pin_hash = $${queryParams.length}`;
  }

  try {
    const result = await db.query(
      `WITH target AS (
         SELECT role AS previous_role
         FROM utilisateurs
         WHERE id = $4
           AND organisation_id = $5
           AND deleted_at IS NULL
       )
       UPDATE utilisateurs
       SET nom   = COALESCE($1, nom),
           email = COALESCE($2, email),
           role  = COALESCE($3, role)
           ${pinHashUpdateStr}
       WHERE id = $4
         AND organisation_id = $5
         AND deleted_at IS NULL
       RETURNING id, nom, email, role, is_kiosk_user, created_at, (SELECT previous_role FROM target) AS previous_role`,
      queryParams,
    );

    const updated = result.rows[0];
    if (updated && updated.is_kiosk_user) {
      const tokenRes = await db.query(`SELECT kiosk_token FROM organisations WHERE id = $1`, [organisationId]);
      const kt = tokenRes.rows[0]?.kiosk_token;
      if (kt) updated.kiosk_url = `/kiosk/${kt}?u=${updated.id}`;
    }
    if (!updated) {
      throw notFoundError();
    }
    return updated;
  } catch (err) {
    if (err.code === "23505") {
      throw duplicateEmailError();
    }

    throw err;
  }
}

async function listRecentTimeEntries({ userId, organisationId }) {
  const result = await db.query(
    `SELECT te.id,
            te.start_time,
            te.end_time,
            te.description,
            te.is_billed,
            p.nom AS projet,
            c.nom AS client,
            EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600 AS heures
     FROM time_entries te
     INNER JOIN utilisateurs u ON u.id = te.utilisateur_id
     LEFT JOIN projets p ON p.id = te.projet_id
     LEFT JOIN clients c ON c.id = p.client_id
     WHERE te.utilisateur_id = $1
       AND u.organisation_id = $2
       AND u.deleted_at IS NULL
     ORDER BY te.start_time DESC
     LIMIT 5`,
    [userId, organisationId],
  );

  return result.rows;
}

async function deleteUser({ userId, currentUserId, organisationId }) {
  if (Number(userId) === Number(currentUserId)) {
    const err = new Error("Vous ne pouvez pas supprimer votre propre compte.");
    err.statusCode = 400;
    throw err;
  }

  try {
    const result = await db.query(
      `UPDATE utilisateurs
       SET deleted_at = NOW()
       WHERE id = $1
         AND organisation_id = $2
         AND deleted_at IS NULL
       RETURNING id`,
      [userId, organisationId],
    );

    if (result.rows.length === 0) {
      throw notFoundError();
    }

    await db.query(
      `UPDATE user_sessions
       SET active = false,
           logout_time = COALESCE(logout_time, NOW()),
           duration_seconds = CASE
             WHEN login_time IS NOT NULL THEN EXTRACT(EPOCH FROM (COALESCE(logout_time, NOW()) - login_time))::int
             ELSE duration_seconds
           END
       WHERE utilisateur_id = $1
         AND active = true`,
      [userId],
    );

    return result.rows[0];
  } catch (err) {
    throw err;
  }
}

async function updatePassword({ userId, data, organisationId }) {
  const { password, mot_de_passe: motDePasse } = data;
  const rawPassword = password || motDePasse;

  requirePassword(rawPassword, "Nouveau mot de passe requis.");

  const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_SALT_ROUNDS);

  const result = await db.query(
    `UPDATE utilisateurs
     SET mot_de_passe = $1
     WHERE id = $2
       AND organisation_id = $3
       AND deleted_at IS NULL
     RETURNING id`,
    [hashedPassword, userId, organisationId],
  );

  if (result.rows.length === 0) {
    throw notFoundError();
  }

  return result.rows[0];
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  listRecentTimeEntries,
  deleteUser,
  updatePassword,
};
