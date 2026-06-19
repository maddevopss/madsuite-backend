const cron = require("node-cron");
const db = require("../../db");
const logger = require("../config/logger");
const nodemailer = require("nodemailer");

/**
 * Génère un template HTML professionnel avec styles inline pour la compatibilité email
 */
function generateWeeklyReportHtml(orgName, totalHours, purgeStats) {
  const brandColor = "#29529b"; // Couleur MADSuite

  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f9; color: #333333;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="padding: 20px 0;">
            <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
              <!-- Header -->
              <tr>
                <td align="center" style="background-color: ${brandColor}; padding: 40px 20px;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 1px;">MADSuite</h1>
                  <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0; font-size: 16px;">Rapport Hebdomadaire de Performance</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="color: #333333; margin-top: 0;">Bonjour,</h2>
                  <p style="font-size: 16px; color: #666666; line-height: 1.5;">Voici le résumé opérationnel pour l'organisation <strong>${orgName}</strong> sur les 7 derniers jours.</p>
                  
                  <!-- Stat Cards -->
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 30px 0;">
                    <tr>
                      <td width="48%" style="background-color: #f8f9fa; border-left: 4px solid ${brandColor}; padding: 20px; border-radius: 4px;">
                        <div style="font-size: 12px; color: #888888; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">Temps Capturé</div>
                        <div style="font-size: 24px; font-weight: bold; color: ${brandColor};">${totalHours} <span style="font-size: 14px;">heures</span></div>
                      </td>
                      <td width="4%"></td>
                      <td width="48%" style="background-color: #f8f9fa; border-left: 4px solid #28a745; padding: 20px; border-radius: 4px;">
                        <div style="font-size: 12px; color: #888888; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">Nettoyage Logs</div>
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${purgeStats.logsCount || 0} <span style="font-size: 14px;">entrées</span></div>
                      </td>
                    </tr>
                  </table>

                  <div style="background-color: #fff9db; padding: 15px; border-radius: 4px; border: 1px solid #ffe066; margin-bottom: 30px;">
                    <p style="margin: 0; font-size: 14px; color: #856404;">
                      <strong>Maintenance système :</strong> ${purgeStats.softDeleteCount || 0} éléments obsolètes ont été définitivement supprimés pour optimiser votre base de données.
                    </p>
                  </div>

                  <div style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL}/dashboard" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Accéder au Dashboard</a>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #eeeeee;">
                  <p style="margin: 0; font-size: 12px; color: #999999;">
                    &copy; 2026 MADSuite — Plateforme de Monitoring de Productivité<br>
                    Ceci est un e-mail automatique, merci de ne pas y répondre.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

async function sendWeeklyReport() {
  try {
    logger.info("Génération du rapport hebdomadaire pour les administrateurs...");

    // 1. Récupération des organisations et de leurs admins
    const orgs = await db.query(`
      SELECT o.id, o.nom, u.email as admin_email 
      FROM organisations o
      JOIN utilisateurs u ON u.organisation_id = o.id
      WHERE u.role = 'admin' AND u.deleted_at IS NULL
    `);

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    for (const org of orgs.rows) {
      // 2. Collecte des stats de purge de la semaine
      const purgeStats = await db.query(
        `
        SELECT details FROM business_audit_logs 
        WHERE organisation_id = $1 AND action = 'system.purge_executed'
        AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 1
      `,
        [org.id],
      );

      // 3. Collecte de l'activité globale
      const activity = await db.query(
        `
        SELECT SUM(total_seconds) / 3600 as hours
        FROM activity_daily_summary
        WHERE organisation_id = $1 AND activity_date > CURRENT_DATE - 7
      `,
        [org.id],
      );

      const totalHours = Math.round(activity.rows[0]?.hours || 0);
      const lastPurge = purgeStats.rows[0]?.details?.stats || {};

      const html = generateWeeklyReportHtml(org.nom, totalHours, lastPurge);

      // 4. Envoi de l'email
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"MADSuite System" <info@maddevops.com>',
        to: org.admin_email,
        subject: `Rapport Hebdomadaire : ${org.nom}`,
        html: html,
      });
    }

    logger.info("Rapports hebdomadaires envoyés avec succès.");
  } catch (err) {
    logger.error("Erreur job weeklyReport", { error: err.message });
  }
}

function initWeeklyReportJob() {
  // Tous les lundis à 08h00
  cron.schedule("0 8 * * 1", () => {
    sendWeeklyReport();
  });
  logger.info("Job de rapport hebdomadaire configuré (Lundi 08:00)");
}

module.exports = { initWeeklyReportJob, sendWeeklyReport, generateWeeklyReportHtml };
