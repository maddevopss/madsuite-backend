const fs = require("fs");
const path = require("path");

describe("accounting reversal period lock contract", () => {
  const servicePath = path.join(__dirname, "../services/business/accounting-reversal-governance.service.js");
  const source = fs.readFileSync(servicePath, "utf8");

  test("imports the central accounting period lock", () => {
    expect(source).toContain('require("./accounting-period-lock.service")');
    expect(source).toContain("assertOpenAccountingPeriod");
  });

  test("checks the requested reversal date inside the transaction", () => {
    expect(source).toContain('entryDate: input.reversalDate');
    expect(source).toContain('operation: "accounting.entry.reverse"');
  });

  test("checks the period before locking or mutating the original entry", () => {
    const guardIndex = source.indexOf("await assertOpenAccountingPeriod(client");
    const originalIndex = source.indexOf("const original = await loadReversibleEntry(client");
    const insertIndex = source.indexOf("INSERT INTO accounting_entries", originalIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(originalIndex).toBeGreaterThan(guardIndex);
    expect(insertIndex).toBeGreaterThan(originalIndex);
  });

  test("keeps preview mode non mutating", () => {
    expect(source).toContain('mode: "preview"');
    expect(source).toContain("mutatesAccounting: false");
  });

  test("preserves idempotent duplicate handling before the period check", () => {
    const duplicateIndex = source.indexOf("if (existing.rows[0]) return { duplicate: true");
    const guardIndex = source.indexOf("await assertOpenAccountingPeriod(client");

    expect(duplicateIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(duplicateIndex);
  });
});
