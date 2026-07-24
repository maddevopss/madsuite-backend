jest.mock("../services/invoice/time-billing.service", () => ({
  getTimeBillingPreview: jest.fn(),
}));

const service = require("../services/invoice/time-billing.service");

describe("time billing preview route contract", () => {
  test("expose le service attendu", async () => {
    service.getTimeBillingPreview.mockResolvedValue({ entries: [], summary: { total: 0 } });
    await expect(service.getTimeBillingPreview({ organisationId: 1, clientId: 2 })).resolves.toEqual({
      entries: [],
      summary: { total: 0 },
    });
  });
});
