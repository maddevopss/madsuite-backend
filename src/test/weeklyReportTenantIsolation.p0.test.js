jest.mock("../../db", () => ({
  query: jest.fn(),
}));

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

const db = require("../../db");
const nodemailer = require("nodemailer");
const { sendWeeklyReport } = require("../jobs/weeklyReport");

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

describe("P0 — isolation multi-tenant du rapport hebdomadaire", () => {
  test("le job traite A puis B sans mélanger destinataires, statistiques ni contenu", async () => {
    const organisations = [
      {
        id: 101,
        nom: "Organisation Alpha",
        admin_email: "alpha-admin@example.test",
      },
      {
        id: 202,
        nom: "Organisation Beta",
        admin_email: "beta-admin@example.test",
      },
    ];

    const sentMessages = [];
    const sendMail = jest.fn(async (message) => {
      sentMessages.push(message);
      return { messageId: `message-${sentMessages.length}` };
    });

    nodemailer.createTransport.mockReturnValue({ sendMail });

    db.query.mockImplementation(async (sql, params = []) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes("FROM organisations o")) {
        return { rows: organisations };
      }

      if (normalized.includes("FROM business_audit_logs")) {
        const organisationId = params[0];
        const stats = organisationId === 101
          ? { logsCount: 11, softDeleteCount: 3 }
          : { logsCount: 22, softDeleteCount: 7 };
        return { rows: [{ details: { stats } }] };
      }

      if (normalized.includes("FROM activity_daily_summary")) {
        const organisationId = params[0];
        return {
          rows: [{ hours: organisationId === 101 ? "5.4" : "12.6" }],
        };
      }

      throw new Error(`Requête inattendue dans la preuve P0: ${normalized}`);
    });

    await sendWeeklyReport();

    expect(db.query).toHaveBeenCalledTimes(5);
    expect(sendMail).toHaveBeenCalledTimes(2);

    const scopedOrganisationIds = db.query.mock.calls
      .filter(([, params]) => Array.isArray(params) && params.length === 1)
      .map(([, params]) => params[0]);

    expect(scopedOrganisationIds).toEqual([101, 101, 202, 202]);

    const alphaMessage = sentMessages.find(
      (message) => message.to === "alpha-admin@example.test",
    );
    const betaMessage = sentMessages.find(
      (message) => message.to === "beta-admin@example.test",
    );

    expect(alphaMessage).toBeDefined();
    expect(betaMessage).toBeDefined();

    expect(alphaMessage.subject).toContain("Organisation Alpha");
    expect(alphaMessage.html).toContain("Organisation Alpha");
    expect(alphaMessage.html).toContain("5 <span");
    expect(alphaMessage.html).toContain("11 <span");
    expect(alphaMessage.html).toContain("3 éléments");
    expect(alphaMessage.html).not.toContain("Organisation Beta");
    expect(alphaMessage.html).not.toContain("22 <span");
    expect(alphaMessage.html).not.toContain("7 éléments");

    expect(betaMessage.subject).toContain("Organisation Beta");
    expect(betaMessage.html).toContain("Organisation Beta");
    expect(betaMessage.html).toContain("13 <span");
    expect(betaMessage.html).toContain("22 <span");
    expect(betaMessage.html).toContain("7 éléments");
    expect(betaMessage.html).not.toContain("Organisation Alpha");
    expect(betaMessage.html).not.toContain("11 <span");
    expect(betaMessage.html).not.toContain("3 éléments");
  });
});
