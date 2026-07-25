const { stableStringify, eventHash } = require("../services/business/business-event.service");
const { EVENT_TO_COLUMN, eventAmount } = require("../services/business/financial-projection.service");

describe("business event ledger", () => {
  test("stableStringify is deterministic regardless of object key order", () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });

  test("eventHash changes when a material event value changes", () => {
    const base = {
      organisationId: 7,
      eventType: "supplier.payment.posted",
      aggregateType: "supplier_bill",
      aggregateId: "41",
      aggregateVersion: 1,
      payload: { amount: 125.5 },
    };
    expect(eventHash(base)).toHaveLength(64);
    expect(eventHash(base)).not.toBe(eventHash({ ...base, payload: { amount: 126 } }));
  });
});

describe("financial projections", () => {
  test("maps supported events to projection columns", () => {
    expect(EVENT_TO_COLUMN["invoice.finalized"]).toBe("invoiced");
    expect(EVENT_TO_COLUMN["supplier.payment.posted"]).toBe("supplier_payments");
  });

  test("normalizes monetary values from amount or total", () => {
    expect(eventAmount({ payload: { amount: "12.345" } })).toBe(12.35);
    expect(eventAmount({ payload: { total: 100 } })).toBe(100);
    expect(eventAmount({ payload: { amount: "invalid" } })).toBe(0);
  });
});
