const {
  buildTrustAssessment,
  createGraphEdge,
} = require("./trust-architecture.service");

async function persistTrustAssessment(client, {
  organisationId,
  transactionId,
  correlationId = null,
  checks = [],
}) {
  const assessment = buildTrustAssessment({ transactionId, organisationId, checks });

  await client.query(
    `INSERT INTO madtrust_assessments
      (assessment_id, organisation_id, transaction_id, correlation_id, score, status, assessed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      assessment.assessmentId,
      organisationId,
      transactionId,
      correlationId,
      assessment.score,
      assessment.status,
      assessment.assessedAt,
    ],
  );

  for (const check of assessment.checks) {
    await client.query(
      `INSERT INTO madtrust_checks
        (organisation_id, assessment_id, code, passed, severity, explanation, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        organisationId,
        assessment.assessmentId,
        check.code,
        check.passed,
        check.severity,
        check.explanation,
        check.evidence,
      ],
    );
  }

  return assessment;
}

async function persistGraphEdges(client, {
  organisationId,
  transactionId,
  correlationId = null,
  edges = [],
}) {
  const persisted = [];

  for (const definition of edges) {
    const edge = createGraphEdge({ organisationId, ...definition });
    const { rows } = await client.query(
      `INSERT INTO business_graph_edges
        (organisation_id, transaction_id, correlation_id, from_type, from_id,
         relation, to_type, to_id, provenance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (organisation_id, transaction_id, from_type, from_id, relation, to_type, to_id)
       DO NOTHING
       RETURNING *`,
      [
        organisationId,
        transactionId,
        correlationId,
        edge.from.type,
        edge.from.id,
        edge.relation,
        edge.to.type,
        edge.to.id,
        edge.provenance || {},
      ],
    );
    if (rows[0]) persisted.push(rows[0]);
  }

  return persisted;
}

module.exports = {
  persistTrustAssessment,
  persistGraphEdges,
};
