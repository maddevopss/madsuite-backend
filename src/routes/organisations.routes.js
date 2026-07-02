const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireSuperAdmin = require("../middleware/requireSuperAdmin");
const organisationService = require("../services/organisation.service");
const ApiResponse = require("../utils/apiResponse");
const { handleServiceError } = require("../utils/routeError");
const { recordBusinessAudit } = require("../services/auditLog.service");

// P1-4 fix: Ces routes sont des routes de gestion de plateforme (niveau super-admin),
// pas des routes d'organisation cliente. Le rôle "administrateur" n'existe pas en DB.
// Remplacé par requireSuperAdmin (basé sur MASTER_ADMIN_USER_IDS) pour cohérence avec
// master-admin.routes.js et system.routes.js.
router.use(auth);
router.use(requireSuperAdmin);

/**
 * GET /api/organisations
 * List all organisations (administrateur)
 */
router.get("/", async (req, res, next) => {
  try {
    const orgs = await organisationService.listAllOrganisations();
    return res.json(ApiResponse.success("ORGANISATIONS_LISTED", orgs));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

/**
 * POST /api/organisations
 * Create a new organisation (administrateur)
 */
router.post("/", async (req, res, next) => {
  try {
    const { nom } = req.body || {};
    const org = await organisationService.createOrganisation({ nom });

    await recordBusinessAudit({
      organisationId: org.id,
      actorUserId: req.user?.id,
      action: "administrateur.create_organisation",
      entityType: "organisation",
      entityId: org.id,
      details: { nom: org.nom },
      req,
    }).catch(() => {});

    return res.status(201).json(ApiResponse.success("ORGANISATION_CREATED", org));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

/**
 * PATCH /api/organisations/:id
 * Update organisation (e.g. rename) - administrateur
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }

    const { nom } = req.body || {};
    const updated = await organisationService.updateOrganisation(id, { nom });

    if (!updated) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Organisation introuvable" }));
    }

    await recordBusinessAudit({
      organisationId: id,
      actorUserId: req.user?.id,
      action: "administrateur.update_organisation",
      entityType: "organisation",
      entityId: id,
      details: { nom: updated.nom },
      req,
    }).catch(() => {});

    return res.json(ApiResponse.success("ORGANISATION_UPDATED", updated));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
