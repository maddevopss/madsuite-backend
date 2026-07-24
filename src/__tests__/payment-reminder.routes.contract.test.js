const fs = require("fs");
const path = require("path");

describe("payment reminders route contract", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "paymentReminders.routes.js"),
    "utf8",
  );

  test("expose les lectures, réglages et envoi manuel", () => {
    expect(source).toContain('router.get("/settings"');
    expect(source).toContain('router.put("/settings"');
    expect(source).toContain('router.get("/candidates"');
    expect(source).toContain('router.get("/history"');
    expect(source).toContain('router.post("/invoices/:id/send"');
  });

  test("réserve les mutations aux administrateurs", () => {
    expect(source).toContain('req.user?.role !== "admin"');
    expect(source).toContain('mode: "manual"');
  });
});
