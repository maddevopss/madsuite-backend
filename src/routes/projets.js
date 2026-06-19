const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");

const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { createProjetSchema } = require("../validators/projet.validator");
const { idParamSchema } = require("../validators/common.validator");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const projetsService = require("../services/projets.service");
const aiService = require("../services/ai.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

router.use(requireOrganisation);

function parseIdParam(req, res) {
  const parsed = idParamSchema.safeParse(req.params);

  if (!parsed.success) {
    res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    return null;
  }

  return parsed.data.id;
}

router.get("/", async (req, res, next) => {
  try {
    const rows = await projetsService.listProjects({
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("PROJECT_LISTED", rows));
  } catch (err) {
    next(err);
  }
});

router.get("/client/:id", async (req, res, next) => {
  try {
    const parsed = idParamSchema.safeParse(req.params);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "clientId invalide" }));
    }

    const rows = await projetsService.listProjectsByClient({
      clientId: parsed.data.id,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("PROJECTS_BY_CLIENT_LISTED", rows));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const projectId = parseIdParam(req, res);
    if (!projectId) return;

    const project = await projetsService.getProjectById({
      projectId,
      organisationId: getOrganisationId(req),
    });

    if (!project) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Projet introuvable" }));
    }

    return res.status(200).json(ApiResponse.success("PROJECT_FOUND", project));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/ai-summary", async (req, res, next) => {
  try {
    const projectId = parseIdParam(req, res);
    if (!projectId) return;

    const summary = await aiService.generateProjectSummary({
      projectId,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("PROJECT_SUMMARY_GENERATED", summary));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = createProjetSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donn\u00e9es invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const project = await projetsService.createProject({
      data: parsed.data,
      organisationId: getOrganisationId(req),
    });

    if (!project) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Client introuvable" }));
    }

    return res.status(201).json(ApiResponse.success("PROJECT_CREATED", project));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const projectId = parseIdParam(req, res);
    if (!projectId) return;

    const parsed = createProjetSchema.partial().safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donn\u00e9es invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const { missingClient, project } = await projetsService.updateProject({
      projectId,
      data: parsed.data,
      organisationId: getOrganisationId(req),
    });

    if (missingClient) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Client introuvable" }));
    }

    if (!project) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Projet introuvable" }));
    }

    return res.status(200).json(ApiResponse.success("PROJECT_UPDATED", project));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const projectId = parseIdParam(req, res);
    if (!projectId) return;

    const deleted = await projetsService.deleteProject({
      projectId,
      organisationId: getOrganisationId(req),
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Projet introuvable" }));
    }

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id,
      action: "project.deleted",
      entityType: "project",
      entityId: deleted.id,
      req,
    });

    return res.status(200).json(ApiResponse.success("PROJECT_DELETED", { deletedId: deleted.id }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
