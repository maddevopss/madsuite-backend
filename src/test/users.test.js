const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

function makeToken({ role = "admin", id = 999, email = "test@example.com", organisation_id } = {}) {
  return jwt.sign(
    {
      id,
      email,
      role,
      organisation_id,
      token_type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("Users", () => {
  test("GET /api/users refuse sans token", async () => {
    const res = await request(app).get("/api/users");

    expect(res.statusCode).toBe(401);
  });

  test("GET /api/users refuse un employé", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Employe ${Date.now()}`,
    });

    const employe = await createTestUser({
      role: "employe",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "employe",
      id: employe.id,
      email: employe.email,
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [employe.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/users refuse admin sans organisation_id", async () => {
    const token = makeToken({
      role: "admin",
      organisation_id: null,
    });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  test("GET /api/users accepte admin avec organisation_id", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Admin ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/users refuse sans token", async () => {
    const res = await request(app).post("/api/users").send({
      nom: "User Test",
      email: "test@example.com",
      mot_de_passe: "Password123!",
      role: "employe",
    });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/users refuse un employé", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Employe Post ${Date.now()}`,
    });

    const employe = await createTestUser({
      role: "employe",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "employe",
      id: employe.id,
      email: employe.email,
      organisation_id: organisation.id,
    });

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        nom: "User Test",
        email: `user-test-${Date.now()}@example.com`,
        mot_de_passe: "Password123!",
        role: "employe",
      });

    expect([401, 403]).toContain(res.statusCode);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [employe.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/users refuse un utilisateur invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Invalid ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({
      nom: "",
      email: "pas-un-email",
      mot_de_passe: "123",
      role: "superboss",
    });

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("POST /api/users refuse un mot de passe sans complexite minimale", async () => {
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
     const createdUser = res.body.data ?? res.body;
     expect(createdUser).toHaveProperty("id");
     expect(createdUser).toHaveProperty("email", email);
     expect(createdUser).toHaveProperty("role", "employe");

const client = await db.connect();

try {
   await client.query("BEGIN");

   await client.query(
     `SELECT set_config('app.current_organisation_id', $1, true)`,
     [String(organisation.id)],
   );

   const dbUser = await client.query(
     `
     SELECT organisation_id
     FROM utilisateurs
     WHERE id = $1
     `,
     [createdUser.id],
   );

   expect(dbUser.rows).toHaveLength(1);
   expect(Number(dbUser.rows[0].organisation_id)).toBe(organisation.id);

   await client.query(`DELETE FROM utilisateurs WHERE id = $1`, [createdUser.id]);

   await client.query("COMMIT");
} catch (error) {
   await client.query("ROLLBACK");
   throw error;
} finally {
   client.release();
}

await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
   });

   test("POST /api/users crée un utilisateur manager avec succès", async () => {
     const organisation = await createTestOrganisation({
       nom: `Org Users Manager ${Date.now()}`,
     });

     const token = makeToken({
       role: "admin",
       organisation_id: organisation.id,
     });

     const email = `manager-${Date.now()}@example.com`;

     const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({
       nom: "User Manager Test",
       email,
       mot_de_passe: "Password123!",
       role: "manager",
     });

     expect(res.statusCode).toBe(201);
     const createdUser = res.body.data ?? res.body;
     expect(createdUser).toHaveProperty("id");
     expect(createdUser).toHaveProperty("email", email);
     expect(createdUser).toHaveProperty("role", "manager");

     const client = await db.connect();

     try {
       await client.query("BEGIN");

       await client.query(
         `SELECT set_config('app.current_organisation_id', $1, true)`,
         [String(organisation.id)],
       );

       const dbUser = await client.query(
         `
         SELECT organisation_id, role
         FROM utilisateurs
         WHERE id = $1
         `,
         [createdUser.id],
       );

       expect(dbUser.rows).toHaveLength(1);
       expect(Number(dbUser.rows[0].organisation_id)).toBe(organisation.id);
       expect(dbUser.rows[0].role).toBe("manager");

       await client.query(`DELETE FROM utilisateurs WHERE id = $1`, [createdUser.id]);

       await client.query("COMMIT");
     } catch (error) {
       await client.query("ROLLBACK");
       throw error;
     } finally {
       client.release();
     }

     await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
   });

   test("POST /api/users refuse un rôle invalide", async () => {
     const organisation = await createTestOrganisation({
       nom: `Org Users Invalid Role ${Date.now()}`,
     });

     const token = makeToken({
       role: "admin",
       organisation_id: organisation.id,
     });

     const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({
       nom: "User Invalid Role",
       email: `invalid-role-${Date.now()}@example.com`,
       mot_de_passe: "Password123!",
       role: "superadmin",
     });

     expect(res.statusCode).toBe(400);
     expect(res.body.fieldErrors || res.body.message).toBeDefined();

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

  test("PUT /api/users/:id refuse un body invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Put Invalid Body ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).put("/api/users/999999").set("Authorization", `Bearer ${token}`).send({
      email: "pas-un-email",
      role: "superboss",
    });

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/users/:id retourne 404 si utilisateur inexistant", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Put 404 ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).put("/api/users/2147483647").set("Authorization", `Bearer ${token}`).send({
      nom: "Utilisateur inexistant",
    });

    expect(res.statusCode).toBe(404);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/users/:id ne modifie pas un utilisateur d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({
      nom: `Org Users A ${Date.now()}`,
    });

    const orgB = await createTestOrganisation({
      nom: `Org Users B ${Date.now()}`,
    });

    const userB = await createTestUser({
      role: "employe",
      organisation_id: orgB.id,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: orgA.id,
    });

    const res = await request(app).put(`/api/users/${userB.id}`).set("Authorization", `Bearer ${token}`).send({
      nom: "Tentative hors organisation",
    });

    expect(res.statusCode).toBe(404);

    const dbUser = await db.query(`SELECT nom FROM utilisateurs WHERE id = $1`, [userB.id]);
    expect(dbUser.rows[0].nom).not.toBe("Tentative hors organisation");

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userB.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("DELETE /api/users/:id refuse un id invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Delete Invalid Id ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).delete("/api/users/abc").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("DELETE /api/users/:id refuse un employé", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Delete Employe ${Date.now()}`,
    });

    const employe = await createTestUser({
      role: "employe",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "employe",
      id: employe.id,
      email: employe.email,
      organisation_id: organisation.id,
    });

    const res = await request(app).delete("/api/users/1").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [employe.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("DELETE /api/users/:id refuse de supprimer son propre compte", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Self Delete ${Date.now()}`,
    });

    const admin = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "admin",
      id: admin.id,
      email: admin.email,
      organisation_id: organisation.id,
    });

    const res = await request(app).delete(`/api/users/${admin.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [admin.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("DELETE /api/users/:id retourne 404 si utilisateur inexistant", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Delete 404 ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).delete("/api/users/2147483647").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(404);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("DELETE /api/users/:id ne supprime pas un utilisateur d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({
      nom: `Org Users Delete A ${Date.now()}`,
    });

    const orgB = await createTestOrganisation({
      nom: `Org Users Delete B ${Date.now()}`,
    });

    const userB = await createTestUser({
      role: "employe",
      organisation_id: orgB.id,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: orgA.id,
    });

    const res = await request(app).delete(`/api/users/${userB.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(404);

    const dbUser = await db.query(`SELECT deleted_at FROM utilisateurs WHERE id = $1`, [userB.id]);
    expect(dbUser.rows[0].deleted_at).toBeNull();

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userB.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("GET /api/users/:id/time-entries/recent refuse un id invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Recent Invalid Id ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/users/abc/time-entries/recent").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/users/:id/time-entries/recent refuse un employé", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Recent Employe ${Date.now()}`,
    });

    const employe = await createTestUser({
      role: "employe",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "employe",
      id: employe.id,
      email: employe.email,
      organisation_id: organisation.id,
    });

    const res = await request(app).get("/api/users/1/time-entries/recent").set("Authorization", `Bearer ${token}`);

    expect([401, 403]).toContain(res.statusCode);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [employe.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/users/:id/time-entries/recent accepte admin et retourne un tableau", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Recent Admin ${Date.now()}`,
    });

    const user = await createTestUser({
      role: "employe",
      organisation_id: organisation.id,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).get(`/api/users/${user.id}/time-entries/recent`).set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("GET /api/users/:id/time-entries/recent masque les entrées d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({
      nom: `Org Users Recent A ${Date.now()}`,
    });

    const orgB = await createTestOrganisation({
      nom: `Org Users Recent B ${Date.now()}`,
    });

    const userB = await createTestUser({
      role: "employe",
      organisation_id: orgB.id,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: orgA.id,
    });

    const res = await request(app).get(`/api/users/${userB.id}/time-entries/recent`).set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userB.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("PUT /api/users/:id/password refuse un id invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Password Invalid Id ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).put("/api/users/abc/password").set("Authorization", `Bearer ${token}`).send({
      mot_de_passe: "Password123!",
    });

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/users/:id/password refuse un body invalide", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Password Invalid Body ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).put("/api/users/999999/password").set("Authorization", `Bearer ${token}`).send({
      mot_de_passe: "123",
    });

    expect(res.statusCode).toBe(400);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/users/:id/password retourne 404 si utilisateur inexistant", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Users Password 404 ${Date.now()}`,
    });

    const token = makeToken({
      role: "admin",
      organisation_id: organisation.id,
    });

    const res = await request(app).put("/api/users/999999/password").set("Authorization", `Bearer ${token}`).send({
      mot_de_passe: "Password123!",
    });

    expect(res.statusCode).toBe(404);

    await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
  });

  test("PUT /api/users/:id/password ne modifie pas un utilisateur d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({
      nom: `Org Users Password A ${Date.now()}`,
    });

    const orgB = await createTestOrganisation({
      nom: `Org Users Password B ${Date.now()}`,
    });

    const userB = await createTestUser({
      role: "employe",
      organisation_id: orgB.id,
      password: "Password123!",
    });

    const token = makeToken({
      role: "admin",
      organisation_id: orgA.id,
    });

    const res = await request(app).put(`/api/users/${userB.id}/password`).set("Authorization", `Bearer ${token}`).send({
      mot_de_passe: "NewPassword123!",
    });

    expect(res.statusCode).toBe(404);

    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userB.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });
});
