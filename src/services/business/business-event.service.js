const crypto = require("crypto");

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function eventHash(event) {
  return crypto.createHash("sha256").update(stableStringify(event)).digest("hex");
}

async function nextAggregateVersion(client, organisationId, aggregateType, aggregateId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(aggregate_version), 0) + 1 AS version
     FROM business_events
     WHERE organisation_id = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
    [organisationId, aggregateType, String(aggregateId)],
  );
  return Number(rows[0].version);
}

async function appendEvent(client, {
  organisationId,
  eventType,
  aggregateType,
  aggregateId,
  actorUserId,
  payload = {},
  metadata = {},
  source = "backend",
  occurredAt = new Date(),
  correlationId = null,
  causationId = null,
}) {
  if (!organisationId || !eventType || !aggregateType || aggregateId === undefined || aggregateId === null) {
    throw Object.assign(new Error("Événement métier incomplet."), { statusCode: 400 });
  }

  const aggregateVersion = await nextAggregateVersion(client, organisationId, aggregateType, aggregateId);
  const normalizedOccurredAt = new Date(occurredAt);
  if (Number.isNaN(normalizedOccurredAt.getTime())) {
    throw Object.assign(new Error("Date d’événement invalide."), { statusCode: 400 });
  }

  const hashInput = {
    organisationId,
    eventType,
    aggregateType,
    aggregateId: String(aggregateId),
    aggregateVersion,
    source,
    actorUserId: actorUserId || null,
    correlationId,
    causationId,
    payload,
    metadata,
    occurredAt: normalizedOccurredAt.toISOString(),
  };

  const { rows } = await client.query(
    `INSERT INTO business_events
      (organisation_id, event_type, aggregate_type, aggregate_id, aggregate_version,
       source, actor_user_id, correlation_id, causation_id, payload, metadata, occurred_at, event_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      organisationId,
      eventType,
      aggregateType,
      String(aggregateId),
      aggregateVersion,
      source,
      actorUserId || null,
      correlationId,
      causationId,
      payload,
      metadata,
      normalizedOccurredAt.toISOString(),
      eventHash(hashInput),
    ],
  );
  return rows[0];
}

async function listEvents(client, organisationId, filters = {}) {
  const values = [organisationId];
  const conditions = ["organisation_id = $1"];
  if (filters.eventType) {
    values.push(filters.eventType);
    conditions.push(`event_type = $${values.length}`);
  }
  if (filters.aggregateType) {
    values.push(filters.aggregateType);
    conditions.push(`aggregate_type = $${values.length}`);
  }
  if (filters.aggregateId) {
    values.push(String(filters.aggregateId));
    conditions.push(`aggregate_id = $${values.length}`);
  }
  values.push(Math.min(Math.max(Number(filters.limit) || 100, 1), 500));
  const { rows } = await client.query(
    `SELECT * FROM business_events
     WHERE ${conditions.join(" AND ")}
     ORDER BY id DESC
     LIMIT $${values.length}`,
    values,
  );
  return rows;
}

module.exports = { stableStringify, eventHash, appendEvent, listEvents };
