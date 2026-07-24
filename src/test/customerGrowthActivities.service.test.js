jest.mock("../../db", () => ({ query: jest.fn() }));

const db = require("../../db");
const {
  assertSingleParent,
  createActivity,
  deleteActivity,
  listActivities,
  normalizeTaskFields,
  updateActivity,
} = require("../services/customerGrowth/activities.service");

describe("customer growth activities service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("refuse une activité sans parent", () => {
    expect(() => assertSingleParent({ lead_id: null, opportunity_id: null })).toThrow(
      "doit être liée à un prospect ou à une opportunité",
    );
  });

  test("refuse une activité liée aux deux parents", () => {
    expect(() => assertSingleParent({ lead_id: 2, opportunity_id: 9 })).toThrow(
      "mais pas aux deux",
    );
  });

  test("accepte exactement un parent", () => {
    expect(() => assertSingleParent({ lead_id: 2, opportunity_id: null })).not.toThrow();
    expect(() => assertSingleParent({ lead_id: null, opportunity_id: 9 })).not.toThrow();
  });

  test("normalise une nouvelle tâche en attente", () => {
    const result = normalizeTaskFields(null, { activity_type: "task" });
    expect(result).toMatchObject({ activity_type: "task", task_status: "pending" });
  });

  test("complète une tâche avec une date", () => {
    const result = normalizeTaskFields(
      { activity_type: "task", task_status: "pending", completed_at: null },
      { task_status: "completed" },
    );
    expect(result.task_status).toBe("completed");
    expect(result.completed_at).toBeInstanceOf(Date);
  });

  test("réouvre une tâche et efface completed_at", () => {
    const result = normalizeTaskFields(
      { activity_type: "task", task_status: "completed", completed_at: new Date() },
      { task_status: "pending" },
    );
    expect(result).toMatchObject({ task_status: "pending", completed_at: null });
  });

  test("efface les champs de tâche lors d'un changement vers note", () => {
    const result = normalizeTaskFields(
      { activity_type: "task", task_status: "pending", due_at: new Date() },
      { activity_type: "note" },
    );
    expect(result).toMatchObject({ activity_type: "note", task_status: null, completed_at: null, due_at: null });
  });

  test("refuse un type d'activité invalide", () => {
    expect(() => normalizeTaskFields(null, { activity_type: "sms" })).toThrow("Type d'activité invalide");
  });

  test("crée une activité avec les paramètres exacts et l'organisation", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 15, organisation_id: 7, activity_type: "call" }] });

    const created = await createActivity({
      organisationId: 7,
      actorUserId: 4,
      data: {
        lead_id: 3,
        activity_type: "call",
        subject: "Premier appel",
        details: "Discussion initiale",
      },
    });

    expect(created.id).toBe(15);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([
      7,
      3,
      null,
      4,
      "call",
      null,
      "Premier appel",
      "Discussion initiale",
      null,
      null,
    ]);
  });

  test("ne touche pas la base lors d'une création sans parent", async () => {
    await expect(
      createActivity({
        organisationId: 7,
        actorUserId: 4,
        data: { activity_type: "note", subject: "Sans parent" },
      }),
    ).rejects.toMatchObject({ code: "ACTIVITY_SINGLE_PARENT_REQUIRED" });
    expect(db.query).not.toHaveBeenCalled();
  });

  test("filtre et borne la liste avec des paramètres exacts", async () => {
    db.query.mockResolvedValue({ rows: [] });

    await listActivities({
      organisationId: 7,
      leadId: 3,
      activityType: "task",
      taskStatus: "pending",
      limit: 999,
      offset: -2,
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("lead_id = $2");
    expect(sql).toContain("activity_type = $3");
    expect(sql).toContain("task_status = $4");
    expect(sql).toContain("organisation_id = $1");
    expect(params).toEqual([7, 3, "task", "pending", 100, 0]);
  });

  test("retourne null sans UPDATE quand l'activité n'existe pas", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await updateActivity({
      activityId: 8,
      organisationId: 7,
      data: { subject: "Nouveau sujet" },
    });

    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test("met à jour une activité avec la portée d'organisation exacte", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 8,
          organisation_id: 7,
          lead_id: 3,
          opportunity_id: null,
          activity_type: "task",
          task_status: "pending",
          completed_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 8, task_status: "completed" }] });

    const result = await updateActivity({
      activityId: 8,
      organisationId: 7,
      data: { task_status: "completed" },
    });

    expect(result.task_status).toBe("completed");
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain("organisation_id");
    expect(params.at(-2)).toBe(8);
    expect(params.at(-1)).toBe(7);
    expect(params.some((value) => value instanceof Date)).toBe(true);
  });

  test("refuse de déplacer une activité vers deux parents sans UPDATE", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 8,
        organisation_id: 7,
        lead_id: 3,
        opportunity_id: null,
        activity_type: "note",
        task_status: null,
      }],
    });

    await expect(
      updateActivity({
        activityId: 8,
        organisationId: 7,
        data: { opportunity_id: 9 },
      }),
    ).rejects.toMatchObject({ code: "ACTIVITY_SINGLE_PARENT_REQUIRED" });

    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test("supprime logiquement avec l'identifiant et l'organisation exacts", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 9 }] });

    const deleted = await deleteActivity({ activityId: 9, organisationId: 7 });

    expect(deleted).toEqual({ id: 9 });
    expect(db.query.mock.calls[0][1]).toEqual([9, 7]);
    expect(db.query.mock.calls[0][0]).toContain("deleted_at = CURRENT_TIMESTAMP");
  });

  test("retourne null quand aucune activité n'est supprimée", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(deleteActivity({ activityId: 99, organisationId: 7 })).resolves.toBeNull();
  });
});
