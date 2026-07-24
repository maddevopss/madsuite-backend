const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const { getOrganisationId } = require("../../utils/organisationScope");
const { handleServiceError } = require("../../utils/routeError");
const ApiResponse = require("../../utils/apiResponse");
const leadsService = require("../../services/customerGrowth/leads.service");
const { convertLeadToClient } = require("../../services/customerGrowth/leadConversion.service");
const {
  convertLeadSchema,
  createLeadSchema,
  leadIdSchema,
  listLeadsQuerySchema,
  parseOrThrow,
  updateLeadSchema,
} = require("../../validation/customerGrowth/leads.schemas");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const query = parseOrThrow(listLeadsQuerySchema, req.query);
    const leads = await leadsService.listLeads({
      organisationId: getOrganisationId(req),
      status: query.status,
      ownerUserId: query.owner_user_id,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(ApiResponse.success("LEADS_LISTED", { leads }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const leadId = parseOrThrow(leadIdSchema, req.params.id);
    const lead = await leadsService.getLeadById({ leadId, organisationId: getOrganisationId(req) });
    if (!lead) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Prospect introuvable." }));
    }
    return res.json(ApiResponse.success("LEAD_FOUND", { lead }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const data = parseOrThrow(createLeadSchema, req.body);
    const lead = await leadsService.createLead({
      data,
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id,
    });
    return res.status(201).json(ApiResponse.success("LEAD_CREATED", { lead }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/:id/convert", requireRole("admin"), async (req, res, next) => {
  try {
    const leadId = parseOrThrow(leadIdSchema, req.params.id);
    const data = parseOrThrow(convertLeadSchema, req.body);
    const conversion = await convertLeadToClient({
      leadId,
      organisationId: getOrganisationId(req),
      idempotencyKey: data.idempotency_key,
    });

    if (!conversion) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Prospect introuvable." }));
    }

    const response = ApiResponse.success("LEAD_CONVERTED", {
      lead: conversion.lead,
      client: conversion.client,
      idempotent: conversion.idempotent,
    });

    return res.status(conversion.idempotent ? 200 : 201).json(response.toJSON());
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.patch("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const leadId = parseOrThrow(leadIdSchema, req.params.id);
    const data = parseOrThrow(updateLeadSchema, req.body);
    const lead = await leadsService.updateLead({ leadId, data, organisationId: getOrganisationId(req) });
    if (!lead) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Prospect introuvable." }));
    }
    return res.json(ApiResponse.success("LEAD_UPDATED", { lead }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const leadId = parseOrThrow(leadIdSchema, req.params.id);
    const deleted = await leadsService.deleteLead({ leadId, organisationId: getOrganisationId(req) });
    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Prospect introuvable ou non supprimable." }));
    }
    return res.json(ApiResponse.success("LEAD_DELETED", { deletedId: deleted.id }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

module.exports = router;
