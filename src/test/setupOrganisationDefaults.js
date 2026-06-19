const jwt = require("jsonwebtoken");
const db = require("../../db");

const DEFAULT_TEST_ORG_ID = Number(process.env.TEST_ORG_ID || 1);
const DEFAULT_TEST_ORG_NAME = "Organisation test par défaut";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function patchJwtSign() {
  if (jwt.__madSuiteOrgPatched) return;

  const originalSign = jwt.sign.bind(jwt);

  jwt.sign = function patchedSign(payload, secretOrPrivateKey, options, callback) {
    if (payload && typeof payload === "object" && !Buffer.isBuffer(payload) && !Array.isArray(payload)) {
      const nextPayload = { ...payload };

      // Important: seulement si absent. Si un test met organisation_id: null explicitement,
      // on respecte son intention.
      if (!hasOwn(nextPayload, "organisation_id")) {
        nextPayload.organisation_id = DEFAULT_TEST_ORG_ID;
      }

      if (!hasOwn(nextPayload, "token_type")) {
        nextPayload.token_type = "access";
      }

      return originalSign(nextPayload, secretOrPrivateKey, options, callback);
    }

    return originalSign(payload, secretOrPrivateKey, options, callback);
  };

  jwt.__madSuiteOrgPatched = true;
}

async function tableExists(tableName) {
  const result = await db.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = $1
    LIMIT 1
    `,
    [tableName],
  );

  return result.rowCount > 0;
}

async function columnExists(tableName, columnName) {
  const result = await db.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName],
  );

  return result.rowCount > 0;
}

async function ensureDefaultOrganisation() {
  if (!(await tableExists("organisations"))) return;

  await db.query(
    `
    INSERT INTO organisations (id, nom)
    VALUES ($1, $2)
    ON CONFLICT (id) DO NOTHING
    `,
    [DEFAULT_TEST_ORG_ID, DEFAULT_TEST_ORG_NAME],
  );

  // Évite que la séquence SERIAL tente de réutiliser id=1.
  await db.pool
    .query(
      `
      SELECT setval(
        pg_get_serial_sequence('organisations', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM organisations), $1),
        true
      )
      `,
      [DEFAULT_TEST_ORG_ID],
    )
    .catch(() => null);
}

async function setOrganisationDefault(tableName) {
  if (!(await tableExists(tableName))) return;
  if (!(await columnExists(tableName, "organisation_id"))) return;

  await db.query(`ALTER TABLE ${tableName} ALTER COLUMN organisation_id SET DEFAULT ${DEFAULT_TEST_ORG_ID}`);
}

async function ensureOrganisationDefaults() {
  await ensureDefaultOrganisation();

  const tables = [
    "utilisateurs",
    "clients",
    "projets",
    "time_entries",
    "activity_logs",
    "activity_daily_summary",
    "activity_patterns",
    "activity_feedback",
    "activity_app_rules",
    "invoices",
    "invoice_items",
    "business_audit_logs",
    "refresh_tokens",
  ];

  for (const tableName of tables) {
    await setOrganisationDefault(tableName);
  }
}

function patchTestDataHelpers() {
  let testData;

  try {
    testData = require("./helpers/testData");
  } catch {
    return;
  }

  if (testData.__madSuiteOrgPatched) return;

  const withDefaultOrg = (overrides = {}) => {
    if (hasOwn(overrides, "organisation_id")) return overrides;
    return { ...overrides, organisation_id: DEFAULT_TEST_ORG_ID };
  };

  if (typeof testData.createTestUser === "function") {
    const original = testData.createTestUser;
    testData.createTestUser = (overrides = {}) => original(withDefaultOrg(overrides));
  }

  if (typeof testData.createTestClient === "function") {
    const original = testData.createTestClient;
    testData.createTestClient = (overrides = {}) => original(withDefaultOrg(overrides));
  }

  if (typeof testData.createTestProjet === "function") {
    const original = testData.createTestProjet;
    testData.createTestProjet = (clientId, overrides = {}) => original(clientId, withDefaultOrg(overrides));
  }

  if (typeof testData.createTestOrganisation === "function") {
    const original = testData.createTestOrganisation;
    testData.createTestOrganisation = (overrides = {}) => original(overrides);
  }

  testData.__madSuiteOrgPatched = true;
}

patchJwtSign();
patchTestDataHelpers();

beforeAll(async () => {
  await ensureOrganisationDefaults();
});
