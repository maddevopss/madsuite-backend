const nodemailer = require("nodemailer");
const { sendResetPasswordEmail } = require("../services/email.service"); // Ajuste le chemin

// On mocke nodemailer
jest.mock("nodemailer");

describe("Email Integration Service", () => {
  let sendMailMock;

  beforeEach(() => {
    sendMailMock = jest.fn().mockResolvedValue({ messageId: "test-id" });
    nodemailer.createTransport.mockReturnValue({
      sendMail: sendMailMock,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("doit appeler sendMail avec les bons paramètres de destination", async () => {
    const destination = "client@example.com";
    const token = "fake-jwt-token";

    await sendResetPasswordEmail(destination, token);

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: destination,
        subject: expect.stringContaining("Réinitialisation"),
        html: expect.stringContaining(token),
      }),
    );
  });
});
