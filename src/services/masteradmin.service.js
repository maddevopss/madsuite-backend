const bcrypt = require("bcrypt");
const db = require("../../db");

async function createClientOrganisation({ organisation_nom, user_nom, email, password }) {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // Vérifier si l'email existe déjà
    const userResult = await client.query(
      `SELECT id FROM utilisateurs WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );

    if (userResult.rows.length > 0) {
      throw new Error("Cet email est déjà utilisé.");
    }

    // 1. Créer l'organisation
    const orgResult = await client.query(
      `
      INSERT INTO organisations (nom, trial_ends_at)
      VALUES ($1, NOW() + INTERVAL '14 days')
      RETURNING id, nom
      `,
      [organisation_nom]
    );

    const organisation = orgResult.rows[0];

    // 2. Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Créer l'utilisateur
    const newUserResult = await client.query(
      `
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, organisation_id, role_org)
      VALUES ($1, $2, $3, 'admin', $4, 'admin')
      RETURNING id, nom, email, role, organisation_id
      `,
      [user_nom, email, passwordHash, organisation.id]
    );

    const user = newUserResult.rows[0];

    await client.query("COMMIT");

    return {
      organisation,
      user
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createClientOrganisation
};
