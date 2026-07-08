const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

function makeToken(overrides = {}) {
  return jwt.sign(
    {
      id: 999,
      email: "users-test@example.com",
      role: "admin",
      ...overrides,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("Users", () => {
  test("GET /api/users retourne seulement les utilisateurs de l'organisation", async () => {
    const organisationA = await createTestOrganisation({ nom: `Org Users A ${Date.now()}` });
    const organisationB = await createTestOrganisation({ nom: `Org Users B ${Date.now()}` });

    const userA = await createTestUser({ organisation_id: organisationA.id, email: `user-a-${Date.now()}@example.com` });
    const userB = await createTestUser({ organisation_id: organisationB.id, email: `user-b-${Date.now()}@example.com` });

    const token = makeToken({
      role: "admin",
      organisation_id: organisationA.id,
    });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.map((user) => user.id)).toContain(userA.id);
    expect(res.body.map((user) => user.id)).not.toContain(userB.id);

    await db.query(`DELETE FROM utilisateurs WHERE id = ANY($1)`, [[userA.id, userB.id]]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1)`, [[organisationA.id, organisationB.id]]);
  });

  test("GET /api/users refuse sans organisation", async () => {
    const token = makeToken({
      role: "admin",
      organisation_id: null,
    });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  test("GET /api/users refuse un role non admin", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Role ${Date.now()}`,
    });

    const token = makeToken({
      role: "employe",
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/users refuse un email invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Invalid Email ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({
      nom: "User Email Invalide",
      email: "not-an-email",
      mot_de_passe: "Password123!",
      role: "employe",
    });

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/users refuse un mot de passe faible", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Weak Password ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        nom: "User Weak Password",
        email: `weak-password-${Date.now()}@example.com`,
        mot_de_passe: "password123",
        role: "employe",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.fieldErrors.mot_de_passe).toEqual(
      expect.arrayContaining([
        "Le mot de passe doit contenir au moins 12 caracteres.",
        "Le mot de passe doit contenir une majuscule.",
        "Le mot de passe doit contenir un caractere special.",
      ]),
    );

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/users crée un utilisateur valide dans la même organisation", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Create ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const email = `creation-${Date.now()}@example.com`;

    const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({
      nom: "User Création Test",
      email,
      mot_de_passe: "Password123!",
      role: "employe",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data).toHaveProperty("email", email);
    expect(res.body.data).toHaveProperty("role", "employe");

    const dbUser = await db.query(
      `
      SELECT organisation_id
      FROM utilisateurs
      WHERE id = $1
      `,
      [res.body.data.id],
    );

    expect(dbUser.rows).toHaveLength(1);
    expect(Number(dbUser.rows[0].organisation_id)).toBe(organisation.id);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [res.body.data.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/users/:id refuse un id invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Put Invalid Id ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).put("/api/users/abc").set("Authorization", `Bearer ${token}`).send({
      nom: "User modifié",
    });

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });
});
