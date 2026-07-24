const {
  createLeadSchema,
  leadIdSchema,
  listLeadsQuerySchema,
  parseOrThrow,
  updateLeadSchema,
} = require("../validation/customerGrowth/leads.schemas");

describe("customer_growth lead route validation", () => {
  test("accepts a minimal valid lead", () => {
    expect(parseOrThrow(createLeadSchema, { display_name: "Atelier Nord" })).toEqual({
      display_name: "Atelier Nord",
    });
  });

  test("rejects organisation_id from the request body", () => {
    expect(() =>
      parseOrThrow(createLeadSchema, {
        display_name: "Atelier Nord",
        organisation_id: 999,
      }),
    ).toThrow("Données de prospect invalides");
  });

  test("rejects converted as a public status transition", () => {
    expect(() => parseOrThrow(updateLeadSchema, { status: "converted" })).toThrow(
      "Données de prospect invalides",
    );
  });

  test("rejects an empty update", () => {
    expect(() => parseOrThrow(updateLeadSchema, {})).toThrow("Données de prospect invalides");
  });

  test("normalizes list pagination", () => {
    expect(parseOrThrow(listLeadsQuerySchema, { limit: "25", offset: "5" })).toEqual({
      limit: 25,
      offset: 5,
    });
  });

  test("rejects unknown query parameters", () => {
    expect(() => parseOrThrow(listLeadsQuerySchema, { organisation_id: "12" })).toThrow(
      "Données de prospect invalides",
    );
  });

  test("accepts only positive integer identifiers", () => {
    expect(parseOrThrow(leadIdSchema, "42")).toBe(42);
    expect(() => parseOrThrow(leadIdSchema, "0")).toThrow("Données de prospect invalides");
  });
});
