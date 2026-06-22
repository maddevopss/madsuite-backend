const nodemailer = require("nodemailer");
const { pool } = require("../../db");
const logger = require("../config/logger");
const { getBullQueue } = require("../config/redis");
const analyticsService = require("./analytics.service");

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

  async _sendWithIdempotency(idempotency_key, mailOptions) {
    if (!idempotency_key) {
      throw new Error("idempotency_key est obligatoire pour l'envoi d'email");
    }

    try {
      const { rows } = await pool.query(
        "SELECT id FROM email_delivery_log WHERE idempotency_key = $1",
        [idempotency_key]
      );

      if (rows.length > 0) {
        logger.info(`Email SKIP (idempotency_key: ${idempotency_key} existe déjà)`);
        return { sent: false, skipped: true, idempotency_key };
      }

      const result = await this.getTransporter().sendMail(mailOptions);

      await pool.query(
        "INSERT INTO email_delivery_log (idempotency_key, recipient, subject, status) VALUES ($1, $2, $3, $4)",
        [idempotency_key, mailOptions.to, mailOptions.subject || 'Sans sujet', 'sent']
      );

      return { sent: true, result, idempotency_key };
    } catch (err) {
      logger.error(`Erreur lors de l'envoi idempotent (${idempotency_key}):`, err.message);
      throw err;
    }
  }

  async sendResetPasswordEmail(to, token, idempotency_key) {
    return this._sendWithIdempotency(idempotency_key, {
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

  async sendSecuritySummary(to, subject, templateData, idempotency_key) {
    if (!idempotency_key) throw new Error("idempotency_key est obligatoire");

    if (this.emailQueue) {
      return this.emailQueue.add(
        "send-security-summary",
        { to, subject, templateData, idempotency_key },
        { priority: this.PRIORITIES.HIGH, attempts: 3 },
      );
    }

    const incidentList = (templateData.incidents || [])
      .map((inc) => `<li><strong>${inc.type}</strong> (IP: ${inc.details?.ip || ""})</li>`)
      .join("");

    return this._sendWithIdempotency(idempotency_key, {
      from: process.env.EMAIL_FROM || '"MADSuite Security" <security@madsuite.com>',
      to,
      subject,
      html: `<h1>Rapport de sécurité MADSuite</h1><ul>${incidentList}</ul>`,
    });
  }

  async sendGentleReminder(to, invoice, idempotency_key) {
    if (!idempotency_key) throw new Error("idempotency_key est obligatoire");

    if (invoice?.organisation_id) {
      analyticsService.trackEvent("dunning_triggered", {
        organisationId: invoice.organisation_id,
        metadata: { invoiceId: invoice.id, type: 'gentle' }
      }).catch(err => logger.error("Analytics error:", err));
    }

    if (this.emailQueue) {
      return this.emailQueue.add("send-invoice-reminder", { to, invoice, type: 'gentle', idempotency_key }, { priority: this.PRIORITIES.NORMAL, attempts: 3 });
    }
    const { invoice_number, total, due_date, public_token } = invoice;
    const portalUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/portal/${public_token}`;
    return this._sendWithIdempotency(idempotency_key, {
      from: process.env.EMAIL_FROM || '"MADSuite Billing" <billing@madsuite.com>',
      to,
      subject: `Rappel amical : Facture ${invoice_number} en attente`,
      html: `
        <h2>Rappel de facture</h2>
        <p>Bonjour,</p>
        <p>Sauf erreur de notre part, le paiement de la facture <strong>${invoice_number}</strong> d'un montant de <strong>${Number(total).toFixed(2)} $</strong> ne nous est pas encore parvenu.</p>
        <p>Celle-ci était due le <strong>${new Date(due_date).toLocaleDateString("fr-FR")}</strong>.</p>
        <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#1976d2;color:white;text-decoration:none;border-radius:4px;">Payer maintenant</a></p>
        <p>Si vous avez déjà procédé au paiement, veuillez ignorer ce message.</p>
      `,
    });
  }

  async sendFirmReminder(to, invoice, idempotency_key) {
    if (!idempotency_key) throw new Error("idempotency_key est obligatoire");

    if (invoice?.organisation_id) {
      analyticsService.trackEvent("dunning_triggered", {
        organisationId: invoice.organisation_id,
        metadata: { invoiceId: invoice.id, type: 'firm' }
      }).catch(err => logger.error("Analytics error:", err));
    }

    if (this.emailQueue) {
      return this.emailQueue.add("send-invoice-reminder", { to, invoice, type: 'firm', idempotency_key }, { priority: this.PRIORITIES.NORMAL, attempts: 3 });
    }
    const { invoice_number, total, due_date, public_token } = invoice;
    const portalUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/portal/${public_token}`;
    return this._sendWithIdempotency(idempotency_key, {
      from: process.env.EMAIL_FROM || '"MADSuite Billing" <billing@madsuite.com>',
      to,
      subject: `Deuxième rappel : Facture ${invoice_number} échue`,
      html: `
        <h2>Facture en retard</h2>
        <p>Bonjour,</p>
        <p>Nous vous contactons car la facture <strong>${invoice_number}</strong> de <strong>${Number(total).toFixed(2)} $</strong> est échue depuis plus de 7 jours.</p>
        <p>Merci de procéder au paiement dans les plus brefs délais via le lien sécurisé ci-dessous.</p>
        <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#f57c00;color:white;text-decoration:none;border-radius:4px;">Régler la facture immédiatement</a></p>
      `,
    });
  }

  async sendFinalReminder(to, invoice, idempotency_key) {
    if (!idempotency_key) throw new Error("idempotency_key est obligatoire");

    if (invoice?.organisation_id) {
      analyticsService.trackEvent("dunning_triggered", {
        organisationId: invoice.organisation_id,
        metadata: { invoiceId: invoice.id, type: 'final' }
      }).catch(err => logger.error("Analytics error:", err));
    }

    if (this.emailQueue) {
      return this.emailQueue.add("send-invoice-reminder", { to, invoice, type: 'final', idempotency_key }, { priority: this.PRIORITIES.HIGH, attempts: 3 });
    }
    const { invoice_number, total, due_date, public_token } = invoice;
    const portalUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/portal/${public_token}`;
    return this._sendWithIdempotency(idempotency_key, {
      from: process.env.EMAIL_FROM || '"MADSuite Billing" <billing@madsuite.com>',
      to,
      subject: `Dernier avis : Facture ${invoice_number} très en retard`,
      html: `
        <h2>Mise en demeure</h2>
        <p>Bonjour,</p>
        <p>En l'absence de règlement de votre facture <strong>${invoice_number}</strong> d'un montant de <strong>${Number(total).toFixed(2)} $</strong>, ceci constitue notre dernier rappel amiable.</p>
        <p>Veuillez régler le solde immédiatement pour éviter d'éventuels frais de retard ou la suspension des services.</p>
        <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#d32f2f;color:white;text-decoration:none;border-radius:4px;">Payer le solde complet</a></p>
      `,
    });
  }

  async sendEstimateReminder(to, estimate, idempotency_key) {
    if (!idempotency_key) throw new Error("idempotency_key est obligatoire");

    if (this.emailQueue) {
      return this.emailQueue.add(
        "send-estimate-reminder",
        { to, estimate, idempotency_key },
        { priority: this.PRIORITIES.NORMAL, attempts: 3 },
      );
    }

    const { estimate_number, total, valid_until, public_token } = estimate;
    const formattedTotal = Number(total).toFixed(2);
    const formattedDate = new Date(valid_until).toLocaleDateString("fr-FR");
    const portalUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/portal/${public_token}`;

    return this._sendWithIdempotency(idempotency_key, {
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
