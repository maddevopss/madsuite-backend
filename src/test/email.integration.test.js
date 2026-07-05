jest.mock("nodemailer");

jest.mock("../../db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const nodemailer = require("nodemailer");
const db = require("../../db");
const { sendResetPasswordEmail } = require("../services/email.service");

describe("Email Integration Service", () => {
  let sendMailMock;

  beforeEach(() => {
    sendMailMock = jest.fn().mockResolvedValue({ messageId: "test-id" });

    nodemailer.createTransport.mockReturnValue({
      sendMail: sendMailMock,
    });

    db.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("doit appeler sendMail avec les bons paramètres de destination", async () => {
    const destination = "client@example.com";
    const token = "fake-jwt-token";
    const idempotency_key = "test-idempotency-key-123";

    await sendResetPasswordEmail(destination, token, idempotency_key);

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: destination,
        subject: expect.stringContaining("Réinitialisation"),
        html: expect.stringContaining(token),
      }),
    );
  });
});