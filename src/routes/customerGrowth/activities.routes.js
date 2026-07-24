const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const { getOrganisationId } = require("../../utils/organisationScope");
const { handleServiceError } = require("../../utils/routeError");
const ApiResponse = require("../../utils/apiResponse");
const activitiesService = require("../../services/customerGrowth/activities.service");
const {
  activityIdSchema,
  createActivitySchema,
  listActivitiesQuerySchema,
  parseOrThrow,
  updateActivitySchema,
} = require("../../validation/customerGrowth/activities.schemas");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const query = parseOrThrow(listActivitiesQuerySchema, req.query);
    const activities = await activitiesService.listActivities({
      organisationId: getOrganisationId(req),
      leadId: query.lead_id,
      opportunityId: query.opportunity_id,
      activityType: query.activity_type,
      taskStatus: query.task_status,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(ApiResponse.success("ACTIVITIES_LISTED", { activities }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const activityId = parseOrThrow(activityIdSchema, req.params.id);
    const activity = await activitiesService.getActivityById({
      activityId,
      organisationId: getOrganisationId(req),
    });
    if (!activity) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Activité commerciale introuvable." }));
    }
    return res.json(ApiResponse.success("ACTIVITY_FOUND", { activity }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const data = parseOrThrow(createActivitySchema, req.body);
    const activity = await activitiesService.createActivity({
      data,
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id,
    });
    return res.status(201).json(ApiResponse.success("ACTIVITY_CREATED", { activity }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.patch("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const activityId = parseOrThrow(activityIdSchema, req.params.id);
    const data = parseOrThrow(updateActivitySchema, req.body);
    const activity = await activitiesService.updateActivity({
      activityId,
      data,
      organisationId: getOrganisationId(req),
    });
    if (!activity) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Activité commerciale introuvable." }));
    }
    return res.json(ApiResponse.success("ACTIVITY_UPDATED", { activity }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const activityId = parseOrThrow(activityIdSchema, req.params.id);
    const deleted = await activitiesService.deleteActivity({
      activityId,
      organisationId: getOrganisationId(req),
    });
    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Activité commerciale introuvable." }));
    }
    return res.json(ApiResponse.success("ACTIVITY_DELETED", { deletedId: deleted.id }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

module.exports = router;
