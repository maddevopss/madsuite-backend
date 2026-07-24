const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const { getOrganisationId } = require("../../utils/organisationScope");
const { handleServiceError } = require("../../utils/routeError");
const ApiResponse = require("../../utils/apiResponse");
const opportunitiesService = require("../../services/customerGrowth/opportunities.service");
const {
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdSchema,
  parseOrThrow,
  updateOpportunitySchema,
} = require("../../validation/customerGrowth/opportunities.schemas");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const query = parseOrThrow(listOpportunitiesQuerySchema, req.query);
    const opportunities = await opportunitiesService.listOpportunities({
      organisationId: getOrganisationId(req),
      status: query.status,
      ownerUserId: query.owner_user_id,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(ApiResponse.success("OPPORTUNITIES_LISTED", { opportunities }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const opportunityId = parseOrThrow(opportunityIdSchema, req.params.id);
    const opportunity = await opportunitiesService.getOpportunityById({
      opportunityId,
      organisationId: getOrganisationId(req),
    });
    if (!opportunity) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Opportunité introuvable." }));
    }
    return res.json(ApiResponse.success("OPPORTUNITY_FOUND", { opportunity }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const data = parseOrThrow(createOpportunitySchema, req.body);
    const opportunity = await opportunitiesService.createOpportunity({
      data,
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id,
    });
    return res.status(201).json(ApiResponse.success("OPPORTUNITY_CREATED", { opportunity }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.patch("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const opportunityId = parseOrThrow(opportunityIdSchema, req.params.id);
    const data = parseOrThrow(updateOpportunitySchema, req.body);
    const opportunity = await opportunitiesService.updateOpportunity({
      opportunityId,
      data,
      organisationId: getOrganisationId(req),
    });
    if (!opportunity) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Opportunité introuvable." }));
    }
    return res.json(ApiResponse.success("OPPORTUNITY_UPDATED", { opportunity }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const opportunityId = parseOrThrow(opportunityIdSchema, req.params.id);
    const deleted = await opportunitiesService.deleteOpportunity({
      opportunityId,
      organisationId: getOrganisationId(req),
    });
    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Opportunité introuvable ou non supprimable." }));
    }
    return res.json(ApiResponse.success("OPPORTUNITY_DELETED", { deletedId: deleted.id }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

module.exports = router;