const db = require("../../db");
const { checkLongRunningTimers } = require("../jobs/checkLongRunningTimers");
const { createTestOrganisation, createTestUser, createTestClient, createTestProjet } = require("./helpers/testData");

async function createOpenTimer({ fixture, description, startInterval }) {
  const result = await db.query(
    `
    INSERT INTO time_entries
      (projet_id, utilisateur_id, start_time, end_time, description, hourly_rate_used, is_billed, organisation_id)
    VALUES
      ($1, $2, NOW() - (${startInterval}), NULL, $3, 100, false, $4)
    RETURNING *
    `,
    [fixture.projet.id, fixture.user.id, description, fixture.organisation.id],
  );

  return result.rows[0];
}

async function createFixture() {
  const organisation = await createTestOrganisation({
    nom: `Long Timer Job Org ${Date.now()}`,
  });
  const user = await createTestUser({
    role: "admin",
    organisation_id: organisation.id,
  });
  const client = await createTestClient({
    nom: `Long Timer Job Client ${Date.now()}`,
    organisation_id: organisation.id,
  });
  const projet = await createTestProjet(client.id, {
    nom: `Long Timer Job Projet ${Date.now()}`,
    organisation_id: organisation.id,
    status: "actif",
  });

  return {
    organisation,
    user,
    client,
    projet,
  };
}

describe("checkLongRunningTimers", () => {
  const previousThreshold = process.env.LONG_TIMER_THRESHOLD_HOURS;

  afterAll(() => {
    if (previousThreshold === undefined) {
      delete process.env.LONG_TIMER_THRESHOLD_HOURS;
      return;
    }

    process.env.LONG_TIMER_THRESHOLD_HOURS = previousThreshold;
  });

  test("detecte et logge seulement les timers ouverts au-dela du seuil", async () => {
    process.env.LONG_TIMER_THRESHOLD_HOURS = "8";

    const fixture = await createFixture();
    const recentFixture = await createFixture();
    const oldTimer = await createOpenTimer({
      fixture,
      description: "Timer oublie",
      startInterval: "INTERVAL '9 hours'",
    });
    const recentTimer = await createOpenTimer({
      fixture: recentFixture,
      description: "Timer recent",
      startInterval: "INTERVAL '30 minutes'",
    });
    const log = {
      warn: jest.fn(),
    };

    const result = await checkLongRunningTimers({ log });

    expect(result.thresholdHours).toBe(8);
    expect(result.timers.some((timer) => timer.id === oldTimer.id)).toBe(true);
    expect(result.timers.some((timer) => timer.id === recentTimer.id)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      "Timers long-running detectes",
      expect.objectContaining({
        count: expect.any(Number),
        thresholdHours: 8,
      }),
    );

    await db.query("DELETE FROM time_entries WHERE id = ANY($1::int[])", [[oldTimer.id, recentTimer.id]]);
    await db.query("DELETE FROM projets WHERE id = ANY($1::int[])", [[fixture.projet.id, recentFixture.projet.id]]);
    await db.query("DELETE FROM clients WHERE id = ANY($1::int[])", [[fixture.client.id, recentFixture.client.id]]);
    await db.query("DELETE FROM utilisateurs WHERE id = ANY($1::int[])", [[fixture.user.id, recentFixture.user.id]]);
    await db.query("DELETE FROM organisations WHERE id = ANY($1::int[])", [
      [fixture.organisation.id, recentFixture.organisation.id],
    ]);
  });
});
