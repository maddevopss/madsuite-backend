const jwt = require("jsonwebtoken");
const request = require("supertest");

const db = require("../../db");
const app = require("../app");
const {
  createTestOrganisation,
  createTestUser,
  createTestClient,
  createTestProjet,
} = require("./helpers/testData");

function makeAdminToken(user, organisation) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: "admin",
      organisation_id: organisation.id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("P0: écritures cross-tenant interdites", () => {
  let orgA;
  let orgB;
  let adminA;
  let adminB;
  let clientA;
  let projetA;
  let tokenB;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;

    orgA = await createTestOrganisation({ nom: `P0 Cross Write A ${suffix}` });
    orgB = await createTestOrganisation({ nom: `P0 Cross Write B ${suffix}` });

    adminA = await createTestUser({
      nom: "Admin A",
      role: "admin",
      organisation_id: orgA.id,
    });
    adminB = await createTestUser({
      nom: "Admin B",
      role: "admin",
      organisation_id: orgB.id,
    });

    clientA = await createTestClient({
      nom: `Client A original ${suffix}`,
      organisation_id: orgA.id,
    });
    projetA = await createTestProjet(clientA.id, {
      nom: `Projet A original ${suffix}`,
      organisation_id: orgA.id,
    });

    tokenB = makeAdminToken(adminB, orgB);
  });

  afterAll(async () => {
    if (projetA) {
      await db.query("DELETE FROM projets WHERE id = $1", [projetA.id]);
    }
    if (clientA) {
      await db.query("DELETE FROM clients WHERE id = $1", [clientA.id]);
    }
    if (adminA || adminB) {
      await db.query("DELETE FROM utilisateurs WHERE id = ANY($1)", [
        [adminA?.id, adminB?.id].filter(Boolean),
      ]);
    }
    if (orgA || orgB) {
      await db.query("DELETE FROM organisations WHERE id = ANY($1)", [
        [orgA?.id, orgB?.id].filter(Boolean),
      ]);
    }
  });

  test("B ne peut pas modifier le client de A", async () => {
    const attemptedName = `Client compromis ${Date.now()}`;

    const response = await request(app)
      .put(`/api/clients/${clientA.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ nom: attemptedName });

    expect([403, 404]).toContain(response.status);

    const persisted = await db.query(
      "SELECT nom, organisation_id FROM clients WHERE id = $1",
      [clientA.id],
    );

    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].nom).toBe(clientA.nom);
    expect(persisted.rows[0].organisation_id).toBe(orgA.id);
  });

  test("B ne peut pas supprimer le projet de A", async () => {
    const response = await request(app)
      .delete(`/api/projets/${projetA.id}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect([403, 404]).toContain(response.status);

    const persisted = await db.query(
      "SELECT nom, organisation_id, client_id FROM projets WHERE id = $1",
      [projetA.id],
    );

    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].nom).toBe(projetA.nom);
    expect(persisted.rows[0].organisation_id).toBe(orgA.id);
    expect(persisted.rows[0].client_id).toBe(clientA.id);
  });

  test("les identifiants de A restent invisibles dans les lectures de B après les attaques", async () => {
    const [clientResponse, projetResponse] = await Promise.all([
      request(app)
        .get(`/api/clients/${clientA.id}`)
        .set("Authorization", `Bearer ${tokenB}`),
      request(app)
        .get(`/api/projets/${projetA.id}`)
        .set("Authorization", `Bearer ${tokenB}`),
    ]);

    expect([403, 404]).toContain(clientResponse.status);
    expect([403, 404]).toContain(projetResponse.status);
  });
});
