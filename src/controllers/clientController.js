const ApiResponse = require("../utils/apiResponse");
const { handleServiceError } = require("../utils/routeError");
const { idParamSchema } = require("../validators/common.validator");
const { createClientSchema, updateClientSchema } = require("../validators/client.validator");
const clientsService = require("../services/clients.service");
const { getOrganisationId } = require("../utils/organisationScope");

function parseClientId(req, res) {
  const params = idParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    return null;
  }

  return params.data.id;
}

exports.getAllClients = async (req, res, next) => {
  try {
    const clients = await clientsService.listClients({ organisationId: getOrganisationId(req) });
    return res.status(200).json(clients);
  } catch (err) {
    next(err);
  }
};

exports.getClientById = async (req, res, next) => {
  try {
    const clientId = parseClientId(req, res);
    if (!clientId) return;

    const client = await clientsService.getClientById({
      clientId,
      organisationId: getOrganisationId(req),
    });

    if (!client) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Client introuvable" }));
    }

    return res.status(200).json(client);
  } catch (err) {
    next(err);
  }
};

exports.createClient = async (req, res, next) => {
  try {
    const parsed = createClientSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const client = await clientsService.createClient({
      data: parsed.data,
      organisationId: getOrganisationId(req),
    });

    return res.status(201).json(client);
  } catch (err) {
    return handleServiceError(err, res, next);
  }
};

exports.updateClient = async (req, res, next) => {
  try {
    const clientId = parseClientId(req, res);
    if (!clientId) return;

    const parsed = updateClientSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const client = await clientsService.updateClient({
      clientId,
      data: parsed.data,
      organisationId: getOrganisationId(req),
    });

    if (!client) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Client introuvable" }));
    }

    return res.status(200).json(client);
  } catch (err) {
    return handleServiceError(err, res, next);
  }
};
