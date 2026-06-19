const nodemailer = require("nodemailer");
const { pool } = require("../../db");
const logger = require("../config/logger");

let Queue = null;
let IORedis = null;

try {
  ({ Queue } = require("bullmq"));
  IORedis = require("ioredis");
} catch {
  Queue = null;
  IORedis = null;
}

function buildTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: String(process.env.EMAIL_PORT || "") === "465",
    auth: process.env.EMAIL_USER
      ? {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        }
      : undefined,
  });
}

class EmailService {
  constructor() {
    this.PRIORITIES = {
      HIGH: 1,
      NORMAL: 10,
      LOW: 100,
    };

    this.THROTTLE_SECONDS = 3600;
    this.transporter = null;

    if (Queue && IORedis) {
      const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
      this.emailQueue = new Queue("email-notifications", { connection });
    } else {
      this.emailQueue = null;
    }
  }

  getTransporter() {
    if (!this.transporter) {
      this.transporter = buildTransporter();
    }

    return this.transporter;
  }

  async sendResetPasswordEmail(to, token) {
    return this.getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@madsuite.local",
      to,
      subject: "Réinitialisation de votre mot de passe MADSuite",
      html: `
        <p>Voici votre lien de réinitialisation MADSuite.</p>
        <p><strong>Token :</strong> ${token}</p>
      `,
    });
  }

  async sendSecurityAlert(userId, { type, ip, userAgent }) {
    try {
      await pool.query(
        `INSERT INTO security_incidents_buffer (organisation_id, utilisateur_id, type, details)
         SELECT organisation_id, id, $2, $3::jsonb
         FROM utilisateurs WHERE id = $1`,
        [userId, type, JSON.stringify({ ip, userAgent, created_at: new Date() })],
      );

      logger.info(`Alerte sécurité mise en buffer pour l'utilisateur ${userId} (Type: ${type})`);
      return { sent: true };
    } catch (err) {
      logger.error("Erreur EmailService:", err.message);
      throw err;
    }
  }

  async sendSecuritySummary(to, subject, templateData) {
    if (this.emailQueue) {
      return this.emailQueue.add(
        "send-security-summary",
        { to, subject, templateData },
        { priority: this.PRIORITIES.HIGH, attempts: 3 },
      );
    }

    const incidentList = (templateData.incidents || [])
      .map((inc) => `<li><strong>${inc.type}</strong> (IP: ${inc.details?.ip || ""})</li>`)
      .join("");

    return this.getTransporter().sendMail({
      from: process.env.EMAIL_FROM || '"MADSuite Security" <security@madsuite.com>',
      to,
      subject,
      html: `<h1>Rapport de sécurité MADSuite</h1><ul>${incidentList}</ul>`,
    });
  }

  async sendInvoiceReminder(to, invoice) {
    if (this.emailQueue) {
      return this.emailQueue.add(
        "send-invoice-reminder",
        { to, invoice },
        { priority: this.PRIORITIES.NORMAL, attempts: 3 },
      );
    }

    const { invoice_number, total, due_date, public_token } = invoice;
    const formattedTotal = Number(total).toFixed(2);
    const formattedDate = new Date(due_date).toLocaleDateString("fr-FR");
    const portalUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/portal/${public_token}`;

    return this.getTransporter().sendMail({
      from: process.env.EMAIL_FROM || '"MADSuite Billing" <billing@madsuite.com>',
      to,
      subject: `Rappel : Facture ${invoice_number} en attente de paiement`,
      html: `
        <h2>Rappel de facture</h2>
        <p>Bonjour,</p>
        <p>Ceci est un rappel amical concernant la facture <strong>${invoice_number}</strong> d'un montant de <strong>${formattedTotal} $</strong>.</p>
        <p>Celle-ci était due le <strong>${formattedDate}</strong>.</p>
        <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#1976d2;color:white;text-decoration:none;border-radius:4px;">Consulter et Payer la Facture</a></p>
        <p>Si vous avez déjà procédé au paiement, veuillez ignorer ce message.</p>
        <br/>
        <p>Merci de votre confiance.</p>
      `,
    });
  }

  async sendEstimateReminder(to, estimate) {
    if (this.emailQueue) {
      return this.emailQueue.add(
        "send-estimate-reminder",
        { to, estimate },
        { priority: this.PRIORITIES.NORMAL, attempts: 3 },
      );
    }

    const { estimate_number, total, valid_until, public_token } = estimate;
    const formattedTotal = Number(total).toFixed(2);
    const formattedDate = new Date(valid_until).toLocaleDateString("fr-FR");
    const portalUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/portal/${public_token}`;

    return this.getTransporter().sendMail({
      from: process.env.EMAIL_FROM || '"MADSuite Billing" <billing@madsuite.com>',
      to,
      subject: `Rappel : Soumission ${estimate_number} en attente`,
      html: `
        <h2>Rappel de soumission</h2>
        <p>Bonjour,</p>
        <p>Nous vous rappelons que la soumission <strong>${estimate_number}</strong> d'un montant de <strong>${formattedTotal} $</strong> est toujours en attente de votre approbation.</p>
        <p>Veuillez noter que cette soumission est valide jusqu'au <strong>${formattedDate}</strong>.</p>
        <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#2e7d32;color:white;text-decoration:none;border-radius:4px;">Consulter la Soumission</a></p>
        <p>N'hésitez pas à nous contacter si vous avez des questions.</p>
        <br/>
        <p>Merci de votre confiance.</p>
      `,
    });
  }
}

const emailService = new EmailService();

module.exports = emailService;
module.exports.EmailService = EmailService;
module.exports.sendResetPasswordEmail = emailService.sendResetPasswordEmail.bind(emailService);
