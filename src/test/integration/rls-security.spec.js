const request = require("supertest");
const app = require("../../app");
const jwt = require("jsonwebtoken");
const { pool } = require("../../../db");

describe("Sécurité RLS - Test de falsification d'Organisation", () => {
  let tokenOrgA;
  let tokenOrgB;
  let clientOrgBId;
  let projectOrgBId;
  let orgAId, orgBId;

  beforeAll(async () => {
    // Nettoyage préalable pour éviter les collisions
    await pool.query("DELETE FROM projets WHERE nom LIKE 'TEST_RLS_%'");
    await pool.query("DELETE FROM clients WHERE nom LIKE 'TEST_RLS_%'");
    await pool.query("DELETE FROM organisations WHERE nom LIKE 'TEST_ORG_%'");

    // 1. Création des organisations de test
    const resOrgA = await pool.query("INSERT INTO organisations (nom) VALUES ('TEST_ORG_A') RETURNING id");
    const resOrgB = await pool.query("INSERT INTO organisations (nom) VALUES ('TEST_ORG_B') RETURNING id");
    orgAId = resOrgA.rows[0].id;
    orgBId = resOrgB.rows[0].id;

    // 2. Création d'un client puis d'un projet pour l'organisation B
    const resClientB = await pool.query(
      "INSERT INTO clients (nom, hourly_rate_defaut, organisation_id) VALUES ('TEST_RLS_CLIENT_B', 100, $1) RETURNING id",
      [orgBId],
    );
    clientOrgBId = resClientB.rows[0].id;

    const resProjB = await pool.query(
      "INSERT INTO projets (nom, client_id, organisation_id) VALUES ('TEST_RLS_PROJET_B', $1, $2) RETURNING id",
      [clientOrgBId, orgBId],
    );
    projectOrgBId = resProjB.rows[0].id;

    // 3. Génération des tokens JWT
    tokenOrgA = jwt.sign({ id: 1001, organisation_id: orgAId, role: "admin", token_type: "access" }, process.env.JWT_SECRET);
    tokenOrgB = jwt.sign({ id: 1002, organisation_id: orgBId, role: "admin", token_type: "access" }, process.env.JWT_SECRET);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM projets WHERE nom LIKE 'TEST_RLS_%'");
    await pool.query("DELETE FROM clients WHERE nom LIKE 'TEST_RLS_%'");
    await pool.query("DELETE FROM organisations WHERE nom LIKE 'TEST_ORG_%'");
  });

  test("Accès légitime : l'organisation B peut lire son propre projet", async () => {
    const response = await request(app)
      .get(`/api/projets/${projectOrgBId}`)
      .set("Cookie", [`access_token=${tokenOrgB}`]);

    expect(response.status).toBe(200);
    expect(response.body.nom).toBe("TEST_RLS_PROJET_B");
  });

  test("Violation RLS : l'organisation A ne doit pas trouver le projet de l'organisation B", async () => {
    const response = await request(app)
      .get(`/api/projets/${projectOrgBId}`)
      .set("Cookie", [`access_token=${tokenOrgA}`]);

    // Le serveur doit répondre 404.
    // Pourquoi 404 et pas 403 ? Car la politique RLS fait en sorte que pour
    // la session de l'Org A, le projet de l'Org B n'existe simplement pas dans la table.
    expect(response.status).toBe(404);
  });

  test("Sécurité par injection : l'organisation A tente de modifier le projet de B", async () => {
    const response = await request(app)
      .put(`/api/projets/${projectOrgBId}`)
      .set("Cookie", [`access_token=${tokenOrgA}`])
      .send({ nom: "HACKED" });

    // La clause UPDATE ne trouvera aucune ligne correspondant à cet ID pour cette organisation
    expect(response.status).toBe(404);
  });
});
