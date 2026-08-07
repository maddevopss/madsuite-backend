/**
 * Service pour gérer les email sequences
 * @module services/email-sequences
 */

const db = require('../core/db');
const logger = require('../observability/logger');
const emailService = require('./email.service');

// Configuration des sequences
const SEQUENCES = {
  onboarding: [
    {
      delay: 0, // Immédiat
      subject: 'Bienvenue sur MADSuite !',
      template: 'onboarding_welcome',
    },
    {
      delay: 24 * 60 * 60 * 1000, // 1 jour
      subject: 'Créez votre première facture',
      template: 'onboarding_first_invoice',
    },
    {
      delay: 3 * 24 * 60 * 60 * 1000, // 3 jours
      subject: 'Découvrez les rapports',
      template: 'onboarding_reports',
    },
    {
      delay: 7 * 24 * 60 * 60 * 1000, // 7 jours
      subject: 'Besoin d\'aide ?',
      template: 'onboarding_support',
    },
  ],
};

/**
 * Enregistre une sequence pour un utilisateur
 * @param {number} userId - ID de l'utilisateur
 * @param {string} sequenceName - Nom de la sequence
 * @returns {Promise<boolean>} Succès
 * @throws {Error} Si la sequence n'existe pas ou si la requête échoue
 */
async function enrollInSequence(userId, sequenceName) {
  try {
    const sequence = SEQUENCES[sequenceName];
    if (!sequence) {
      throw new Error(`Unknown sequence: ${sequenceName}`);
    }

    // Enregistrer chaque email de la sequence
    for (const email of sequence) {
      const scheduledAt = new Date(Date.now() + email.delay);

      await db.query(
        `INSERT INTO email_sequences (user_id, sequence_name, email_subject, email_template, scheduled_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [userId, sequenceName, email.subject, email.template, scheduledAt]
      );
    }

    logger.info('User enrolled in sequence', { userId, sequenceName });
    return true;
  } catch (error) {
    logger.error('Error enrolling user in sequence', { userId, sequenceName, error });
    throw error;
  }
}

/**
 * Envoie les emails en attente
 * Doit être appelé toutes les heures via un scheduler
 * @returns {Promise<Object>} Résumé de l'exécution
 * @throws {Error} Si une erreur critique se produit
 */
async function sendPendingEmails() {
  const summary = {
    totalEmails: 0,
    sentEmails: 0,
    failedEmails: 0,
    errors: [],
  };

  try {
    logger.info('Starting email sequence job');

    const result = await db.query(
      `SELECT id, user_id, email_subject, email_template, scheduled_at
       FROM email_sequences
       WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 100`
    );

    const emails = result.rows;
    logger.info(`Found ${emails.length} pending emails`);

    for (const email of emails) {
      try {
        summary.totalEmails += 1;

        // Récupérer l'utilisateur
        const userResult = await db.query(
          'SELECT email FROM utilisateurs WHERE id = $1',
          [email.user_id]
        );

        if (userResult.rows.length === 0) {
          logger.warn('User not found for email sequence', { userId: email.user_id });
          continue;
        }

        const userEmail = userResult.rows[0].email;

        // Envoyer l'email
        await emailService.sendEmail({
          to: userEmail,
          subject: email.email_subject,
          template: email.email_template,
        });

        // Marquer comme envoyé
        await db.query(
          `UPDATE email_sequences SET status = 'sent', sent_at = NOW() WHERE id = $1`,
          [email.id]
        );

        summary.sentEmails += 1;
        logger.info('Email sent', { emailId: email.id, userEmail });
      } catch (error) {
        summary.failedEmails += 1;
        summary.errors.push({
          emailId: email.id,
          error: error.message,
        });

        logger.error('Error sending email', { emailId: email.id, error });

        // Marquer comme échoué
        await db.query(
          `UPDATE email_sequences SET status = 'failed', error_message = $1 WHERE id = $2`,
          [error.message, email.id]
        );
      }
    }

    logger.info('Email sequence job completed', summary);
    return summary;
  } catch (error) {
    logger.error('Critical error in email sequence job', { error });
    throw error;
  }
}

/**
 * Récupère l'historique des emails pour un utilisateur
 * @param {number} userId - ID de l'utilisateur
 * @returns {Promise<Array>} Historique des emails
 * @throws {Error} Si la requête échoue
 */
async function getEmailHistory(userId) {
  try {
    const result = await db.query(
      `SELECT id, sequence_name, email_subject, status, sent_at, created_at
       FROM email_sequences
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error fetching email history', { userId, error });
    throw error;
  }
}

/**
 * Récupère les statistiques des email sequences
 * @returns {Promise<Object>} Statistiques
 * @throws {Error} Si la requête échoue
 */
async function getEmailStats() {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_emails,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_emails,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_emails,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_emails
       FROM email_sequences`
    );

    return result.rows[0] || {
      total_emails: 0,
      sent_emails: 0,
      pending_emails: 0,
      failed_emails: 0,
    };
  } catch (error) {
    logger.error('Error fetching email stats', { error });
    throw error;
  }
}

module.exports = {
  enrollInSequence,
  sendPendingEmails,
  getEmailHistory,
  getEmailStats,
  SEQUENCES,
};
