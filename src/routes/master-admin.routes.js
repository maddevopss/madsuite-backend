const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");
const auth = require("../middleware/auth");
const { createClientOrganisation } = require("../services/masteradmin.service");
const { recordBusinessAudit } = require("../services/auditLog.service");
const { z } = require("zod");

/**
 * Master Admin access control.
 *
 * RULES (per audit P0 #2):
 * - No more magic `user.id === 1`
 * - Explicit list via MASTER_ADMIN_USER_IDS env (comma-separated IDs)
 * - All actions must produce an audit trail
 * - Future: should evolve to explicit role/permission + migration
 */
const requireMasterAdmin = (req, res, next) => {
  const masterAdminEnv = process.env.MASTER_ADMIN_USER_IDS;
  
  // P0 SECURITY: No default, force explicit env var
  if (!masterAdminEnv) {
    console.error("CRITICAL: MASTER_ADMIN_USER_IDS not set in environment");
    return res.status(500).json(ApiResponse.error("INTERNAL_ERROR", {
      message: "Master admin configuration error. Contact system administrator.",
    }));
  }

  const masterIds = masterAdminEnv
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(Boolean);

  // Ensure parsed list is not empty
  if (!masterIds.length) {
    console.error("CRITICAL: MASTER_ADMIN_USER_IDS parsed to empty list");
    return res.status(500).json(ApiResponse.error("INTERNAL_ERROR", {
      message: "Master admin configuration error. Contact system administrator.",
    }));
  }

  if (req.user && masterIds.includes(req.user.id)) {
    return next();
  }

  return res.status(403).json(ApiResponse.error("FORBIDDEN", {
    message: "Accès réservé au Master Admin.",
  }));
};

const createOrgSchema = z.object({
  organisation_nom: z.string().min(2, "Nom d'organisation requis"),
  user_nom: z.string().min(2, "Nom d'utilisateur requis"),
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "Mot de passe min 8 caractères"),
});

router.use(auth);
router.use(requireMasterAdmin);

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

    // Audit trail for master admin action (P0 #2 requirement)
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
      // Never fail the main action because of audit
      console.error("Master admin audit log failed (non-blocking):", auditErr.message);
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