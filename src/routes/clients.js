const router = require("express").Router();
const clientController = require("../controllers/clientController");
const { requireOrganisation } = require("../middleware/organization.middleware");
const requireRole = require("../middleware/requireRole");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const clientsService = require("../services/clients.service");
const { recordBusinessAudit } = require("../services/auditLog.service");
const ApiResponse = require("../utils/apiResponse");

// Toutes les routes clients nécessitent un contexte d'organisation pour le RLS
router.use(requireOrganisation);

router.get("/", clientController.getAllClients);
router.get("/:id", clientController.getClientById);
router.post("/", requireRole("admin"), clientController.createClient);
router.put("/:id", requireRole("admin"), clientController.updateClient);

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }

    const deleted = await clientsService.deleteClient({
      clientId,
      organisationId: getOrganisationId(req),
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Client introuvable" }));
    }

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id,
      action: "client.deleted",
      entityType: "client",
      entityId: deleted.id,
      req,
    });

    return res.status(200).json({ deletedId: deleted.id });
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
