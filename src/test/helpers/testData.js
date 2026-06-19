const bcrypt = require("bcrypt");
const pool = require("../../../db");
const { BCRYPT_SALT_ROUNDS } = require("../../config/security");

async function createTestOrganisation(overrides = {}) {
  const result = await pool.query(
    `
    INSERT INTO organisations (nom)
    VALUES ($1)
    RETURNING *
    `,
    [overrides.nom || `Organisation Test ${Date.now()} ${Math.random()}`],
  );

  return result.rows[0];
}

async function createTestUser(overrides = {}) {
  const email = overrides.email || `test-${Date.now()}-${Math.random()}@example.com`;
  const nom = overrides.nom || "User Test";
  const role = overrides.role || "admin";
  const password = overrides.password || "Password123!";
  const hashed = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const result = await pool.query(
    `
    INSERT INTO utilisateurs (nom, email, mot_de_passe, role, organisation_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, nom, email, role, organisation_id
    `,
    [nom, email, hashed, role, overrides.organisation_id ?? null],
  );

  return {
    ...result.rows[0],
    password,
  };
}

async function createTestClient(overrides = {}) {
  const result = await pool.query(
    `
    INSERT INTO clients (nom, hourly_rate_defaut, organisation_id)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [overrides.nom || `Client Test ${Date.now()}`, overrides.hourly_rate_defaut ?? 100, overrides.organisation_id ?? null],
  );

  return result.rows[0];
}

async function createTestProjet(clientId, overrides = {}) {
  const result = await pool.query(
    `
    INSERT INTO projets (client_id, nom, taux_horaire, status, organisation_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [
      clientId,
      overrides.nom || `Projet Test ${Date.now()}`,
      overrides.taux_horaire ?? 100,
      overrides.status || "actif",
      overrides.organisation_id ?? null,
    ],
  );

  return result.rows[0];
}

module.exports = {
  createTestOrganisation,
  createTestUser,
  createTestClient,
  createTestProjet,
};
