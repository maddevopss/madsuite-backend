const db = require("../../db");
const { expireTrials } = require("../services/trialExpiration.service");

describe("trialExpiration.service", () => {
  beforeEach(async () => {
    // Cleanup before each test
    await db.query("DELETE FROM organisations WHERE nom LIKE 'Test%'");
  });

  afterAll(async () => {
    // Cleanup after all tests
    await db.query("DELETE FROM organisations WHERE nom LIKE 'Test%'");
  });

  test("expire les trials qui ont dépassé trial_ends_at", async () => {
    // Créer une org avec trial expiré
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NOW() - INTERVAL '1 day', 'trialing', 'free')
       RETURNING id, nom`,
      ["Test Expired Trial Org"]
    );
    const org = orgRes.rows[0];

    const result = await expireTrials();

    expect(result.status).toBe("success");
    expect(result.expired_count).toBeGreaterThan(0);

    // Vérifier que l'org est maintenant expired
    const updated = await db.query(
      "SELECT subscription_status FROM organisations WHERE id = $1",
      [org.id]
    );
    expect(updated.rows[0].subscription_status).toBe("expired");
  });

  test("ne modifie pas les orgs avec subscription_status = 'active'", async () => {
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NOW() - INTERVAL '1 day', 'active', 'pro')
       RETURNING id, nom`,
      ["Test Active Subscription Org"]
    );
    const org = orgRes.rows[0];

    await expireTrials();

    const updated = await db.query(
      "SELECT subscription_status FROM organisations WHERE id = $1",
      [org.id]
    );
    expect(updated.rows[0].subscription_status).toBe("active");
  });

  test("ne modifie pas les orgs avec plan_type = 'admin'", async () => {
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NOW() - INTERVAL '1 day', 'trialing', 'admin')
       RETURNING id, nom`,
      ["Test Admin Org"]
    );
    const org = orgRes.rows[0];

    await expireTrials();

    const updated = await db.query(
      "SELECT subscription_status FROM organisations WHERE id = $1",
      [org.id]
    );
    expect(updated.rows[0].subscription_status).toBe("trialing");
  });

  test("ne modifie pas les orgs avec plan_type = 'internal'", async () => {
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NOW() - INTERVAL '1 day', 'trialing', 'internal')
       RETURNING id, nom`,
      ["Test Internal Org"]
    );
    const org = orgRes.rows[0];

    await expireTrials();

    const updated = await db.query(
      "SELECT subscription_status FROM organisations WHERE id = $1",
      [org.id]
    );
    expect(updated.rows[0].subscription_status).toBe("trialing");
  });

  test("est idempotent", async () => {
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NOW() - INTERVAL '1 day', 'trialing', 'free')
       RETURNING id, nom`,
      ["Test Idempotent Org"]
    );
    const org = orgRes.rows[0];

    const result1 = await expireTrials();
    const result2 = await expireTrials();

    expect(result1.expired_count).toBeGreaterThan(0);
    expect(result2.expired_count).toBe(0); // Deuxième appel ne change rien
  });

  test("trial actif non expiré reste trialing", async () => {
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NOW() + INTERVAL '1 day', 'trialing', 'free')
       RETURNING id, nom`,
      ["Test Active Trial Org"]
    );
    const org = orgRes.rows[0];

    await expireTrials();

    const updated = await db.query(
      "SELECT subscription_status FROM organisations WHERE id = $1",
      [org.id]
    );
    expect(updated.rows[0].subscription_status).toBe("trialing");
  });

  test("ignore les orgs avec trial_ends_at = NULL", async () => {
    const orgRes = await db.query(
      `INSERT INTO organisations (nom, trial_ends_at, subscription_status, plan_type)
       VALUES ($1, NULL, 'trialing', 'free')
       RETURNING id, nom`,
      ["Test Null Trial Org"]
    );
    const org = orgRes.rows[0];

    await expireTrials();

    const updated = await db.query(
      "SELECT subscription_status FROM organisations WHERE id = $1",
      [org.id]
    );
    expect(updated.rows[0].subscription_status).toBe("trialing");
  });
});
