const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const nodemailer = require("nodemailer");
const logger = require("../config/logger");

const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const worker = new Worker(
  "email-notifications",
  async (job) => {
    const { to, subject, templateData } = job.data;

    if (job.name === "send-security-alert") {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"MADSuite Security" <security@madsuite.com>',
        to,
        subject,
        html: `
        <h1>Alerte de sécurité MADSuite</h1>
        <p>Une tentative de réutilisation de session a été détectée sur votre compte.</p>
        <ul>
          <li><strong>Type :</strong> ${templateData.type}</li>
          <li><strong>IP :</strong> ${templateData.ip}</li>
          <li><strong>Appareil :</strong> ${templateData.userAgent}</li>
        </ul>
        <p>Par mesure de sécurité, toutes vos sessions actives ont été déconnectées.</p>
        <p>Si vous n'êtes pas à l'origine de cette activité, nous vous recommandons de changer votre mot de passe immédiatement.</p>
      `,
      });
    } else if (job.name === "send-security-summary") {
      const incidentList = templateData.incidents.map(inc => 
        `<li><strong>${inc.type}</strong> (IP: ${inc.details.ip}) le ${new Date(inc.details.created_at).toLocaleString()}</li>`
      ).join('');

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"MADSuite Security" <security@madsuite.com>',
        to,
        subject,
        html: `
          <h1>Rapport de sécurité MADSuite</h1>
          <p>Bonjour ${templateData.userName}, plusieurs activités suspectes ont été détectées sur votre compte récemment :</p>
          <ul>
            ${incidentList}
          </ul>
          <p>Par mesure de sécurité, nous avons invalidé vos sessions. Si vous ne reconnaissez pas ces activités, changez votre mot de passe.</p>
        `,
      });
    } else if (job.name === "send-weekly-report") {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"MADSuite System" <info@madsuite.com>',
        to,
        subject,
        html: `
          <h1>Rapport Hebdomadaire ${templateData.orgName}</h1>
          <p>Voici un résumé de votre activité...</p>
          <!-- Utiliser ici ta fonction de génération HTML existante -->
        `,
      });
    }
  },
  { connection },
);

worker.on("completed", (job) => {
  logger.info(`Email job ${job.id} envoyé avec succès à ${job.data.to}`);
});

worker.on("failed", (job, err) => {
  logger.error(`Email job ${job.id} a échoué: ${err.message}`);
});

module.exports = worker;
