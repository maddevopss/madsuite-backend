const router = require("express").Router();

const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");

const { updateRetentionSchema } = require("../validators/organisation.validator");
const organisationService = require("../services/organisation.service");
const logger = require("../utils/logger");
const ApiResponse = require("../utils/apiResponse");

/**
 * GET /api/organisation/health
 * Route de diagnostic rapide pour la Beta
 */
router.get("/health", auth, async (req, res) => {
  try {
    const dbCheck = await organisationService.getOrganisationSettings(req.user.organisation_id, req.db || undefined);
    return res.status(200).json(ApiResponse.success("HEALTH_OK", { 
      database: !!dbCheck,
      timestamp: new Date().toISOString() 
    }));
  } catch (error) {
    res.status(500).json(ApiResponse.error("HEALTH_ERROR", { message: "Problème de connexion DB" }));
  }
});

/**
 * GET /api/organisation/retention
 * Récupère les paramètres de rétention actuels
 */
router.get("/retention", auth, requireRole("admin"), requireOrganisation, async (req, res) => {
  try {
    const settings = await organisationService.getOrganisationSettings(req.user.organisation_id, req.db);
    if (!settings) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Organisation non trouvée" }));
    }
    return res.status(200).json(ApiResponse.success("ORGANISATION_RETENTION_LISTED", settings));
  } catch (error) {
    logger.error("Erreur lors de la récupération de la rétention", { error: error.message });
    res.status(500).json(ApiResponse.error("INTERNAL_ERROR", { message: "Erreur serveur" }));
  }
});

/**
 * GET /api/organisation/audit-logs
 */
router.get("/audit-logs", auth, requireRole("admin"), requireOrganisation, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    const { email, action } = req.query;

    const logs = await organisationService.getOrganisationAuditLogs(req.user.organisation_id, limit, offset, email, action, req.db);
    return res.status(200).json(ApiResponse.success("ORGANISATION_AUDIT_LOGS_LISTED", logs));
  } catch (error) {
    logger.error("Erreur récupération audit logs", { error: error.message });
    res.status(500).json(ApiResponse.error("INTERNAL_ERROR", { message: "Erreur serveur" }));
  }
});

/**
 * GET /api/organisation/audit-logs/export
 */
router.get("/audit-logs/export", auth, requireRole("admin"), requireOrganisation, async (req, res) => {
  try {
    const { email, action } = req.query;
    const logs = await organisationService.getOrganisationAuditLogsForExport(req.user.organisation_id, email, action, req.db);

    let csv = "\uFEFFDate,Utilisateur,Action,Details\n"; // BOM pour support UTF-8 dans Excel
    logs.forEach((log) => {
      const date = new Date(log.created_at).toLocaleString();
      const user = (log.utilisateur_email || "Système").replace(/"/g, '""');
      const act = (log.action || "").replace(/"/g, '""');
      // On s'assure que les détails JSON sont bien échappés pour le CSV
      const details = JSON.stringify(log.details || {}).replace(/"/g, '""');
      csv += `"${date}","${user}","${act}","${details}"\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=audit_logs.csv");
    return res.status(200).send(csv);
  } catch (error) {
    logger.error("Erreur export audit logs", { error: error.message });
    res.status(500).json(ApiResponse.error("INTERNAL_ERROR", { message: "Erreur serveur" }));
  }
});

/**
 * PATCH /api/organisation/retention
 * Permet à un admin de modifier les politiques de rétention de son organisation
 */
router.patch("/retention", auth, requireRole("admin"), requireOrganisation, async (req, res) => {
  try {
    // Validation des données
    const validatedData = updateRetentionSchema.parse(req.body);

    // Mise à jour via le service
    const updatedOrg = await organisationService.updateOrganisationRetention(
      req.user.organisation_id,
      validatedData,
      req.user.id, // Ajout du userId pour les logs d'audit
      req.db
    );

    if (!updatedOrg) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Organisation non trouvée" }));
    }

    logger.info(`Politiques de rétention mises à jour pour l'organisation ${req.user.organisation_id}`);

    return res.status(200).json(ApiResponse.success("ORGANISATION_RETENTION_UPDATED", updatedOrg));
  } catch (error) {
    if (error.name === "ZodError")
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: error.errors }));
    logger.error("Erreur lors de la mise à jour de la rétention", { error: error.message });
    res.status(500).json(ApiResponse.error("INTERNAL_ERROR", { message: "Erreur serveur" }));
  }
});

module.exports = router;
