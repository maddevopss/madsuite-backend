const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");
const auth = require("../middleware/auth");
const requireSuperAdmin = require("../middleware/requireSuperAdmin");
const { createClientOrganisation } = require("../services/masteradmin.service");
const { recordBusinessAudit } = require("../services/auditLog.service");
const logger = require("../config/logger");
const { z } = require("zod");

/**
 * Master Admin access control.
 *
 * RULES:
 * - No magic hardcoded user id.
 * - Shared platform superadmin guard via requireSuperAdmin.
 * - Explicit list via MASTER_ADMIN_USER_IDS env.
 * - All actions must produce an audit trail.
 * - Future: should evolve to explicit role/permission + migration.
 */

const createOrgSchema = z.object({
  organisation_nom: z.string().trim().min(2, "Nom d'organisation requis").max(255),
  user_nom: z.string().trim().min(2, "Nom d'utilisateur requis").max(255),
  email: z.string().trim().email("Email invalide").max(320),
  password: z.string().min(12, "Mot de passe min 12 caractères").max(200),
});

router.use(auth);
router.use(requireSuperAdmin);

router.post("/organisations", async (req, res, next) => {
  try {
    const parsed = createOrgSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const result = await createClientOrganisation(parsed.data);

    // Audit trail for master admin action.
    try {
      await recordBusinessAudit({
        organisationId: result.organisation?.id || null,
        actorUserId: req.user?.id,
        action: "master_admin.create_organisation",
        entityType: "organisation",
        entityId: result.organisation?.id,
        details: {
          created_by_master_admin: true,
          master_admin_user_id: req.user?.id,
          new_org_name: result.organisation?.nom,
          new_user_email: result.user?.email,
        },
        req,
      });
    } catch (auditErr) {
      // Never fail the main action because of audit.
      logger.warn("Master admin audit log failed", { error: auditErr.message });
    }

    return res.status(201).json(ApiResponse.success("ORGANISATION_CREATED", result));
  } catch (err) {
    if (err.message === "Cet email est déjà utilisé.") {
      return res.status(409).json(ApiResponse.error("CONFLICT", { message: err.message }));
    }
    next(err);
  }
});

module.exports = router;
