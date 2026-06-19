const { getOrganisationId, organisationScope, organisationValue, normalizeTimezone } = require("../utils/organisationScope");

describe("organisationScope", () => {
  test("getOrganisationId lit l'organisation depuis le user du token", () => {
    expect(getOrganisationId({ user: { organisation_id: 42 } })).toBe(42);
    expect(getOrganisationId({ user: {} })).toBeNull();
  });

  test("organisationScope force une egalite stricte quand l'organisation existe", () => {
    const params = ["already"];

    const sql = organisationScope("te", params, 7);

    expect(sql).toBe("AND te.organisation_id = $2");
    expect(params).toEqual(["already", 7]);
  });

  test("organisationScope echoue quand aucune organisation n'est fournie", () => {
    const params = [];

    expect(() => organisationScope("te", params, null)).toThrow("OrganisationId requis");
    expect(params).toEqual([]);
  });

  test("organisationValue normalise undefined vers null", () => {
    expect(organisationValue(undefined)).toBeNull();
    expect(organisationValue(12)).toBe(12);
  });

  test("normalizeTimezone limite aux fuseaux supportes", () => {
    expect(normalizeTimezone("UTC")).toBe("UTC");
    expect(normalizeTimezone("Europe/Paris")).toBe("Europe/Paris");
    expect(normalizeTimezone("Mars/Olympus")).toBe("America/Montreal");
  });
});
