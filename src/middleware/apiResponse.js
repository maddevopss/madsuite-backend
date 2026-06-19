const ApiResponse = require("../utils/apiResponse");

function isStandardResponse(body) {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof body.success === "boolean" &&
      typeof body.code === "string" &&
      Object.prototype.hasOwnProperty.call(body, "data") &&
      typeof body.timestamp === "string",
  );
}

function normalizeCodePart(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function responseCode(req, status) {
  const route = normalizeCodePart(req.baseUrl || req.path || req.originalUrl) || "API";
  const action = status >= 400 ? "FAILED" : "OK";
  return `${route}_${action}`;
}

function normalizeErrors(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { message: String(body || "Erreur API") };
  }

  if (body.errors && typeof body.errors === "object") {
    return {
      ...(body.message ? { message: body.message } : {}),
      ...body.errors,
    };
  }

  return {
    ...(body.message ? { message: body.message } : {}),
    ...(body.error ? { message: body.error } : {}),
  };
}

function apiResponseMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (isStandardResponse(body)) {
      return originalJson(body);
    }

    const status = res.statusCode || 200;
    const code = responseCode(req, status);
    const response =
      status >= 400
        ? ApiResponse.error(code, normalizeErrors(body))
        : ApiResponse.success(code, body === undefined ? null : body);

    return originalJson(response);
  };

  next();
}

module.exports = apiResponseMiddleware;
module.exports.isStandardResponse = isStandardResponse;
