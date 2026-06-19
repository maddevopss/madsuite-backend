const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const db = require("../../db");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

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

async function ensureActivityPatternsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_patterns (
      id SERIAL PRIMARY KEY,
      organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
      projet_id INTEGER NOT NULL REFERENCES projets(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      weight NUMERIC DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

describe("Project Detection multi-organisation", () => {
  beforeAll(async () => {
    await db.query(`ALTER TABLE projets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await ensureActivityPatternsTable();
  });

  test("POST /api/project-detection/suggest ne suggère pas un projet d'une autre organisation", async () => {
    const orgA = await createTestOrganisation({ nom: `PD A ${Date.now()}` });
    const orgB = await createTestOrganisation({ nom: `PD B ${Date.now()}` });

    const userA = await createTestUser({ role: "admin", organisation_id: orgA.id });

    const clientA = await createTestClient({
      nom: `PD Client A ${Date.now()}`,
      organisation_id: orgA.id,
    });

    const clientB = await createTestClient({
      nom: `PD Client B ${Date.now()}`,
      organisation_id: orgB.id,
    });

    const projetA = await createTestProjet(clientA.id, {
      nom: `Projet Local Sans Rapport ${Date.now()}`,
      organisation_id: orgA.id,
    });

    const projetBName = `Projet Secret Autre Org ${Date.now()}`;

    const projetB = await createTestProjet(clientB.id, {
      nom: projetBName,
      organisation_id: orgB.id,
    });

    const res = await request(app)
      .post("/api/project-detection/suggest")
      .set("Authorization", `Bearer ${makeToken(userA)}`)
      .send({
        appName: "Code",
        windowTitle: `${projetBName} - fichier.js`,
      });

    expect(res.statusCode).toBe(200);

    const ids = res.body.suggestions.map((row) => row.id);

    expect(ids).not.toContain(projetB.id);

    await db.query(`DELETE FROM projets WHERE id = ANY($1::int[])`, [[projetA.id, projetB.id]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[clientA.id, clientB.id]]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [userA.id]);
    await db.query(`DELETE FROM organisations WHERE id = ANY($1::int[])`, [[orgA.id, orgB.id]]);
  });

  test("POST /api/project-detection/patterns crée un pattern dans l'organisation du user", async () => {
    const org = await createTestOrganisation({ nom: `PD Pattern Org ${Date.now()}` });
    const user = await createTestUser({ role: "admin", organisation_id: org.id });
    const client = await createTestClient({ nom: `PD Pattern Client ${Date.now()}`, organisation_id: org.id });
    const projet = await createTestProjet(client.id, { nom: `PD Pattern Projet ${Date.now()}`, organisation_id: org.id });

    const keyword = `pattern-org-${Date.now()}`;

    const res = await request(app)
      .post("/api/project-detection/patterns")
      .set("Authorization", `Bearer ${makeToken(user)}`)
      .send({
        projet_id: projet.id,
        keyword,
        weight: 2,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.keyword).toBe(keyword);
    expect(Number(res.body.organisation_id)).toBe(org.id);

    await db.query(`DELETE FROM activity_patterns WHERE id = $1`, [res.body.id]);
    await db.query(`DELETE FROM projets WHERE id = $1`, [projet.id]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    await db.query(`DELETE FROM utilisateurs WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM organisations WHERE id = $1`, [org.id]);
  });
});
