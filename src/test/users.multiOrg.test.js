const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organisation_id: user.organisation_id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("Users multi-organisation", () => {
  test("GET /api/users liste seulement les utilisateurs de son organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Users A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Users B ${Date.now()}` });

    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const userA = await createTestUser({ role: "employe", organisation_id: orgA.id });
    const userB = await createTestUser({ role: "employe", organisation_id: orgB.id });

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${makeToken(adminA)}`);

    expect(res.statusCode).toBe(200);

    const ids = res.body.map((row) => row.id);

    expect(ids).toContain(adminA.id);
    expect(ids).toContain(userA.id);
    expect(ids).not.toContain(userB.id);

    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[adminA.id, userA.id, userB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("POST /api/users ignore organisation_id du payload et utilise celle de l'admin", async () => {
    const orgA = await createTestOrganisation({ nom: `Users Payload A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Users Payload B ${Date.now()}` });

    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${makeToken(adminA)}`)
      .send({
        nom: "Employé Payload Org",
        email: `payload-org-${Date.now()}@example.com`,
        mot_de_passe: "Password123!",
        role: "employe",
        organisation_id: orgB.id,
      });

    expect(res.statusCode).toBe(201);

    const dbUser = await db.query(
      `
      SELECT organisation_id
      FROM utilisateurs
      WHERE id = $1
      `,
      [res.body.id],
    );

    expect(Number(dbUser.rows[0].organisation_id)).toBe(orgA.id);

    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[adminA.id, res.body.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("PUT /api/users/:id ne modifie pas un utilisateur hors organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `Users Put A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `Users Put B ${Date.now()}` });

    const adminA = await createTestUser({ role: "admin", organisation_id: orgA.id });
    const userB = await createTestUser({ role: "employe", organisation_id: orgB.id });

    const res = await request(app)
      .put(`/api/users/${userB.id}`)
      .set("Authorization", `Bearer ${makeToken(adminA)}`)
      .send({
        nom: "Modif Interdite",
      });

    expect(res.statusCode).toBe(404);

    const dbUser = await db.query(`SELECT nom FROM utilisateurs WHERE id = $1`, [userB.id]);
    expect(dbUser.rows[0].nom).not.toBe("Modif Interdite");

    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1::int[])`, [[adminA.id, userB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });
});
