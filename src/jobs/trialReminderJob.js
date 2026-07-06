const cron = require("node-cron");
const db = require("../../db");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");
const analyticsService = require("../services/analytics.service");
const { expireTrials } = require("../services/trialExpiration.service");

async function checkAndSendTrialReminders() {
  const client = await db.pool.connect();
  try {
    // 1. Expire les trials qui ont dépassé trial_ends_at
    try {
      await expireTrials();
    } catch (err) {
      logger.error("Erreur lors de l'expiration des trials", { error: err.message });
      // Continue anyway — les reminders doivent s'envoyer même si l'expiration échoue
    }

    // 2. Near expiry (2 days)
    const nearResult = await client.query(`
      SELECT o.id as org_id, o.nom as org_nom, o.trial_ends_at, u.email as admin_email, u.nom as admin_nom
      FROM organisations o
      JOIN utilisateurs u ON u.organisation_id = o.id AND u.role_org = 'admin'
      WHERE o.trial_ends_at IS NOT NULL
        AND o.trial_ends_at::date = (NOW() + INTERVAL '2 days')::date
        AND u.deleted_at IS NULL
    `);

    for (const row of nearResult.rows) {
      logger.info(`Envoi de l'alerte de fin d'essai à ${row.admin_email} pour l'organisation ${row.org_nom}`);

      try {
        await analyticsService.trackEvent("trial_near_expiry", {
          organisationId: row.org_id,
          metadata: { days_left: 2 }
        });
      } catch (e) { /* non blocking */ }

      const subject = `Rappel : Votre essai gratuit se termine bientôt !`;
      const text = `Bonjour ${row.admin_nom},\n\nVotre période d'essai gratuit pour ${row.org_nom} se termine dans 2 jours.\nN'oubliez pas d'ajouter une méthode de paiement dans vos paramètres pour continuer à utiliser MADSuite sans interruption.\n\nL'équipe MADSuite`;
      
      await emailService.sendEmail({
        to: row.admin_email,
        subject,
        text
      });
    }

    // 3. Already expired (for analytics only)
    const expiredResult = await client.query(`
      SELECT o.id as org_id, o.nom as org_nom
      FROM organisations o
      WHERE o.trial_ends_at IS NOT NULL
        AND o.trial_ends_at < NOW()
        AND o.subscription_status = 'expired'
    `);

    for (const row of expiredResult.rows) {
      try {
        await analyticsService.trackEvent("trial_expired", {
          organisationId: row.org_id,
          metadata: {}
        });
      } catch (e) { /* non blocking */ }
      logger.info(`Trial expired for org ${row.org_nom} (id=${row.org_id})`);
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
