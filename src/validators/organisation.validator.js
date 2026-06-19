const { z } = require("zod");

/**
 * Limite maximale de rétention : 10 ans (3650 jours)
 * Limite minimale : 1 jour
 */
const MAX_RETENTION_DAYS = 3650;
const MIN_RETENTION_DAYS = 1;

const updateRetentionSchema = z
  .object({
    retention_activity_logs_days: z
      .number({ invalid_type_error: "Le délai des logs d'activité doit être un nombre" })
      .int()
      .min(MIN_RETENTION_DAYS, `Le délai minimum est de ${MIN_RETENTION_DAYS} jour`)
      .max(MAX_RETENTION_DAYS, `Le délai ne peut dépasser 10 ans (${MAX_RETENTION_DAYS} jours)`)
      .optional(),

    retention_summary_days: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),

    retention_audit_logs_days: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),

    interac_email: z.string().email().optional().or(z.literal("")),

    interac_question: z.string().max(255).optional().or(z.literal("")),
  })
  .strict(); // Empêche l'envoi de champs inconnus

module.exports = { updateRetentionSchema };
