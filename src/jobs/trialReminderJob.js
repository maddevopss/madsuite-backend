const cron = require("node-cron");
const db = require("../../db");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");

async function checkAndSendTrialReminders() {
  const client = await db.pool.connect();
  try {
    // Trouver les organisations dont l'essai se termine dans exactement 2 jours (jour 12)
    // et récupérer leur administrateur.
    const result = await client.query(`
      SELECT o.id as org_id, o.nom as org_nom, o.trial_ends_at, u.email as admin_email, u.nom as admin_nom
      FROM organisations o
      JOIN utilisateurs u ON u.organisation_id = o.id AND u.role_org = 'admin'
      WHERE o.trial_ends_at IS NOT NULL
        AND o.trial_ends_at::date = (NOW() + INTERVAL '2 days')::date
        AND u.deleted_at IS NULL
    `);

    for (const row of result.rows) {
      logger.info(`Envoi de l'alerte de fin d'essai à ${row.admin_email} pour l'organisation ${row.org_nom}`);
      
      const subject = `Rappel : Votre essai gratuit se termine bientôt !`;
      const text = `Bonjour ${row.admin_nom},\n\nVotre période d'essai gratuit pour ${row.org_nom} se termine dans 2 jours.\nN'oubliez pas d'ajouter une méthode de paiement dans vos paramètres pour continuer à utiliser MADSuite sans interruption.\n\nL'équipe MADSuite`;
      
      // Envoi de l'email via emailService (qui est configuré pour console.log par défaut si SMTP n'est pas configuré)
      await emailService.sendEmail({
        to: row.admin_email,
        subject,
        text
      });
    }

  } catch (err) {
    logger.error("Erreur lors de la vérification des essais gratuits", { error: err.message });
  } finally {
    client.release();
  }
}

// Planifier l'exécution tous les jours à 08h00 du matin
function startTrialReminderJob() {
  cron.schedule("0 8 * * *", () => {
    logger.info("Exécution du job de rappel d'essai gratuit");
    checkAndSendTrialReminders();
  });
  logger.info("Job de rappel d'essai gratuit configuré (tous les jours à 08h00)");
}

module.exports = {
  startTrialReminderJob,
  checkAndSendTrialReminders
};
