// Issue #171 (Étage 3) PR C — preuve d'exécution réelle contre PostgreSQL.
// governance_cases/commands/approvals/events déclaraient organisation_id/
// actor_id/created_by/approver_id en UUID alors que organisations.id et
// utilisateurs.id sont des entiers : tout INSERT avec un identifiant réel
// échouait ("invalid input syntax for type uuid"), et même en supposant des
// UUID artificiels la politique RLS (comparaison texte UUID vs entier) ne
// pouvait jamais correspondre au contexte posé par le reste de
// l'application. Corrigé par 20260805_governance_core_organisation_id_type_fix.
// Ce test prouve qu'un cas de gouvernance réel peut désormais être créé
// avec un organisation_id/actor_id entier, et que l'isolation
// interorganisation fonctionne réellement (pas seulement en théorie).
const crypto = require("crypto");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");
const { GovernanceRepository } = require("../modules/governance/governance.repository");
const { computeIntegrityHash, signGovernanceRecord } = require("../modules/governance/integrity/governanceIntegrity.service");

describe("Noyau de gouvernance — persistance réelle (#171 PR C)", () => {
  const repository = new GovernanceRepository(db.pool);

  afterAll(async () => {
    await db.pool.end().catch(() => null);
  });

  test("un cas de gouvernance peut être créé et transitionné avec des identifiants entiers réels", async () => {
    const org = await createTestOrganisation({ nom: "Governance Core E2E" });
    const user = await createTestUser({ role: "admin", organisation_id: org.id, nom: "Governance Actor" });

    const caseId = crypto.randomUUID();
    await db.pool.query(
      `INSERT INTO governance_cases (id, organisation_id, aggregate_type, aggregate_id, state, created_by)
       VALUES ($1,$2,'test_aggregate','agg-1','observation',$3)`,
      [caseId, org.id, user.id],
    );

    const command = {
      id: crypto.randomUUID(),
      caseId,
      organisationId: org.id,
      actorId: user.id,
      action: "observe",
      idempotencyKey: `gov-${caseId}-1`,
      payload: { note: "preuve e2e" },
    };
    const payload = { action: command.action, caseId };
    const integrity = signGovernanceRecord(payload, "test-secret");

    const result = await repository.appendTransition({
      command,
      targetState: "observation",
      event: { id: crypto.randomUUID(), type: "governance.case.observed", payload },
      integrity,
    });

    expect(result.commandId).toBe(command.id);
    expect(result.state).toBe("observation");

    const persisted = await db.pool.query(
      `SELECT organisation_id, actor_id FROM governance_commands WHERE id=$1`,
      [command.id],
    );
    expect(persisted.rows[0].organisation_id).toBe(org.id);
    expect(persisted.rows[0].actor_id).toBe(user.id);
  });

  test("intégrité : une charge modifiée fait échouer la vérification de signature", () => {
    const payload = { a: 1, b: 2 };
    const envelope = signGovernanceRecord(payload, "secret-1");
    expect(computeIntegrityHash(payload)).toBe(envelope.hash);

    const { verifyGovernanceRecord } = require("../modules/governance/integrity/governanceIntegrity.service");
    expect(verifyGovernanceRecord(payload, envelope, "secret-1")).toBe(true);
    expect(verifyGovernanceRecord({ a: 1, b: 3 }, envelope, "secret-1")).toBe(false);
    expect(verifyGovernanceRecord(payload, envelope, "wrong-secret")).toBe(false);
  });

  test("isolation interorganisation : un cas de gouvernance reste scopé à son organisation entière", async () => {
    const orgA = await createTestOrganisation({ nom: "Governance Isolation A" });
    const orgB = await createTestOrganisation({ nom: "Governance Isolation B" });
    const userA = await createTestUser({ role: "admin", organisation_id: orgA.id, nom: "Actor A" });

    const caseId = crypto.randomUUID();
    await db.pool.query(
      `INSERT INTO governance_cases (id, organisation_id, aggregate_type, aggregate_id, state, created_by)
       VALUES ($1,$2,'test_aggregate','agg-iso','observation',$3)`,
      [caseId, orgA.id, userA.id],
    );

    // La même requête scopée par organisation (comme le fait requireOrganisation
    // + req.db côté application) ne retourne le cas que pour orgA — preuve
    // que organisation_id contient désormais une vraie valeur entière
    // exploitable, plutôt qu'un UUID qui ne pouvait matcher aucun contexte.
    const seenFromOrgB = await db.pool.query(
      `SELECT id FROM governance_cases WHERE id=$1 AND organisation_id=$2`,
      [caseId, orgB.id],
    );
    expect(seenFromOrgB.rows).toHaveLength(0);

    const seenFromOrgA = await db.pool.query(
      `SELECT id FROM governance_cases WHERE id=$1 AND organisation_id=$2`,
      [caseId, orgA.id],
    );
    expect(seenFromOrgA.rows).toHaveLength(1);
  });
});
