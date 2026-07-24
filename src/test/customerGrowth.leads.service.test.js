jest.mock("../../db", () => ({
  query: jest.fn(),
}));

jest.mock("../utils/organisationScope", () => ({
  organisationScope: jest.fn((table, params, organisationId) => {
    params.push(organisationId);
    return `AND ${table}.organisation_id = $${params.length}`;
  }),
  organisationValue: jest.fn((organisationId) => organisationId),
}));

const db = require("../../db");
const {
  assertTransitionAllowed,
  createLead,
  deleteLead,
  getLeadById,
  listLeads,
  updateLead,
} = require("../services/customerGrowth/leads.service");

describe("customerGrowth leads service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("refuse une transition interdite", () => {
    expect(() => assertTransitionAllowed("new", "won")).toThrow(
      "Transition de prospect interdite",
    );
  });

  test("autorise la transition new vers contacted", () => {
    expect(() => assertTransitionAllowed("new", "contacted")).not.toThrow();
  });

  test("liste les prospects avec portée d'organisation", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });

    const result = await listLeads({ organisationId: 42, status: "new" });

    expect(result).toEqual([{ id: 1 }]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("sales_leads.organisation_id"),
      expect.arrayContaining([42, "new"]),
    );
  });

  test("retourne null quand le prospect n'existe pas", async () => {
    db.query.mockResolvedValue({ rows: [] });

    await expect(getLeadById({ leadId: 9, organisationId: 42 })).resolves.toBeNull();
  });

  test("crée un prospect avec organisation et acteur", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 3, status: "new" }] });

    const result = await createLead({
      organisationId: 42,
      actorUserId: 7,
      data: { display_name: "Entreprise Démo", email: "demo@example.com" },
    });

    expect(result).toEqual({ id: 3, status: "new" });
    expect(db.query.mock.calls[0][1]).toEqual([
      42,
      7,
      7,
      "Entreprise Démo",
      null,
      "demo@example.com",
      null,
      null,
      null,
    ]);
  });

  test("exige un motif pour disqualifier", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: "contacted" }] });

    await expect(
      updateLead({
        leadId: 1,
        organisationId: 42,
        data: { status: "unqualified" },
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "UNQUALIFIED_REASON_REQUIRED" });
  });

  test("supprime logiquement seulement dans l'organisation", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });

    const result = await deleteLead({ leadId: 1, organisationId: 42 });

    expect(result).toEqual({ id: 1 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status <> 'converted'"),
      [1, 42],
    );
  });
});
