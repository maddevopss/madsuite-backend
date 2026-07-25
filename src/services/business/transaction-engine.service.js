const crypto = require("crypto");
const db = require("../../../db");

const policies = new Map();

function registerPolicy(name, version, evaluate) {
  if (!name || !version || typeof evaluate !== "function") throw new TypeError("Politique invalide.");
  policies.set(`${name}@${version}`, { name, version, evaluate });
}

function resolvePolicy(ref) {
  const policy = policies.get(ref);
  if (!policy) throw Object.assign(new Error(`Politique inconnue: ${ref}`), { statusCode: 500 });
  return policy;
}

async function evaluatePolicy({ policy: ref, ...context } = {}) {
  const policy = resolvePolicy(ref);
  const result = await policy.evaluate(context);
  const normalized = typeof result === "boolean" ? { allowed: result } : result;
  return { name: policy.name, version: policy.version, ...normalized };
}

async function evaluatePolicies(refs = [], context) {
  const results = [];
  for (const ref of refs) {
    const result = await evaluatePolicy({ policy: ref, ...context });
    results.push(result);
  }
  const denied = results.find((result) => result.allowed === false);
  if (denied) {
    const error = new Error(denied.reason || `Transaction refusée par ${denied.name}.`);
    error.statusCode = denied.statusCode || 409;
    error.policy = denied;
    throw error;
  }
  return results;
}

function createTransactionId() {
  return `CTM-${new Date().getUTCFullYear()}-${crypto.randomUUID()}`;
}

async function executeTransaction(definition) {
  const {
    type,
    organisationId,
    actorUserId = null,
    idempotencyKey = null,
    correlationId = crypto.randomUUID(),
    policies: policyRefs = [],
    validate,
    execute,
    verify,
  } = definition || {};

  if (!type || !organisationId || typeof execute !== "function") {
    throw Object.assign(new Error("Définition transactionnelle incomplète."), { statusCode: 400 });
  }

  const client = await db.pool.connect();
  const transactionId = createTransactionId();
  try {
    await client.query("BEGIN");
    const context = { client, transactionId, correlationId, type, organisationId, actorUserId, idempotencyKey, input: definition.input || {} };
    const policyResults = await evaluatePolicies(policyRefs, context);
    if (validate) await validate(context);
    const result = await execute(context);
    if (verify) await verify({ ...context, result });
    await client.query("COMMIT");
    return { transactionId, correlationId, type, policyResults, result, status: "executed" };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    error.transactionId = transactionId;
    error.correlationId = correlationId;
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { registerPolicy, resolvePolicy, evaluatePolicy, evaluatePolicies, executeTransaction, createTransactionId };
