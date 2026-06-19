const express = require("express");
const router = express.Router();

const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const usersService = require("../services/users.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

const { createUserSchema, updateUserSchema, updatePasswordSchema } = require("../validators/user.validator");
const { idParamSchema } = require("../validators/common.validator");

router.use(requireRole("admin"));
router.use(requireOrganisation);

function parseIdParam(req, res) {
  const params = idParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    return null;
  }
  return params.data.id;
}

router.get("/", async (req, res, next) => {
  try {
    const users = await usersService.listUsers({ organisationId: req.organisationId });
    return res.status(200).json(ApiResponse.success("USER_LISTED", users));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }
    const user = await usersService.createUser({ data: parsed.data, organisationId: req.organisationId });
    return res.status(201).json(ApiResponse.success("USER_CREATED", user));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const userId = parseIdParam(req, res);
    if (!userId) return;

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const user = await usersService.updateUser({
      userId,
      data: parsed.data,
      organisationId: req.organisationId,
    });

    const previousRole = user.previous_role;
    delete user.previous_role;

    if (parsed.data.role && previousRole && parsed.data.role !== previousRole) {
      await recordBusinessAudit({
        organisationId: req.organisationId,
        actorUserId: req.user?.id,
        action: "user.role_changed",
        entityType: "user",
        entityId: user.id,
        details: { previousRole, nextRole: parsed.data.role },
        req,
      });
    }

    return res.status(200).json(ApiResponse.success("USER_UPDATED", user));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/:id/time-entries/recent", async (req, res, next) => {
  try {
    const userId = parseIdParam(req, res);
    if (!userId) return;

    const entries = await usersService.listRecentTimeEntries({
      userId,
      organisationId: req.organisationId,
    });

    return res.status(200).json(ApiResponse.success("RECENT_TIME_ENTRIES_LISTED", entries));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const userId = parseIdParam(req, res);
    if (!userId) return;

    const deleted = await usersService.deleteUser({
      userId,
      currentUserId: req.user.id,
      organisationId: req.organisationId,
    });

    await recordBusinessAudit({
      organisationId: req.organisationId,
      actorUserId: req.user?.id,
      action: "user.deleted",
      entityType: "user",
      entityId: deleted.id,
      req,
    });

    return res.status(200).json(ApiResponse.success("USER_DELETED", {
      deletedId: deleted.id,
      message: "Utilisateur supprime.",
    }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.put("/:id/password", async (req, res, next) => {
  try {
    const userId = parseIdParam(req, res);
    if (!userId) return;

    const parsed = updatePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    await usersService.updatePassword({
      userId,
      data: parsed.data,
      organisationId: req.organisationId,
    });

    return res.status(200).json(ApiResponse.success("PASSWORD_UPDATED", {
      message: "Mot de passe modifie.",
    }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
