const request = require("supertest");
const app = require("./src/app");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./src/test/helpers/testData");
const jwt = require("jsonwebtoken");
const db = require("./db");
const SupertestTest = require("supertest/lib/test");

const originalThen = SupertestTest.prototype.then;
function exposeApiResponse(response) {
  const body = response?.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.success !== "boolean" || typeof body.code !== "string" || !Object.prototype.hasOwnProperty.call(body, "data")) {
    return response;
  }
  response.apiResponse = body;
  if (body.success) {
    response.body = body.data;
  }
  return response;
}
SupertestTest.prototype.then = function patchedThen(resolve, reject) {
  return originalThen.call(this, (response) => resolve(exposeApiResponse(response)), reject);
};

function makeToken(overrides = {}) {
  return jwt.sign(
    { id: 999, email: "test@example.com", role: "admin", ...overrides },
    process.env.JWT_SECRET, { expiresIn: "1h" }
  );
}

async function run() {
  const organisation = await createTestOrganisation({ nom: `Org ${Date.now()}` });
  const user = await createTestUser({ role: "admin", password: "Password123!", organisation_id: organisation.id });
  const client = await createTestClient({ organisation_id: organisation.id, hourly_rate_defaut: 90 });
  const projet = await createTestProjet(client.id, { organisation_id: organisation.id, nom: `Projet ${Date.now()}`, taux_horaire: 125 });
  const token = makeToken({ id: user.id, email: user.email, role: user.role, organisation_id: organisation.id });
  
  await db.query("INSERT INTO organisation_modules (organisation_id, module_key, is_active) VALUES ($1, 'invoices', true)", [organisation.id]);

  const result = await db.query(
    `INSERT INTO time_entries (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
     VALUES ($1, $2, '2026-06-01T09:00:00Z', '2026-06-01T11:00:00Z', 'Analyse facture', 100, false, $3) RETURNING *`,
    [projet.id, user.id, organisation.id]
  );
  
  console.log("Calling API...");
  const res = await request(app)
    .get(`/api/invoices`)
    .set("Authorization", `Bearer ${token}`);
    
  console.log("Status:", res.status);
  console.log("BodyKeys:", Object.keys(res.body || {}));
  console.log("BodyType:", Array.isArray(res.body) ? "Array" : typeof res.body);
  console.log("HasData:", res.body?.data !== undefined);
  
  process.exit(0);
}

run().catch(console.error);
