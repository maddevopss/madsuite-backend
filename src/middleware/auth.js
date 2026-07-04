// Middleware d'authentification pour protéger les routes
const jwt = require("jsonwebtoken");
const ApiResponse = require("../utils/apiResponse");

function getAccessToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  return req.cookies?.access_token || null;
}

function unauthorized(res) {
  return res.status(401).json(
    ApiResponse.error("UNAUTHORIZED", {
      message: "Authentication required.",
    }),
  );
}

// Vérifie le token JWT dans les requêtes protégées
module.exports = (req, res, next) => {
  const token = getAccessToken(req);

  if (!token) {
    return unauthorized(res);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (decoded.token_type === "refresh") {
      return unauthorized(res);
    }

    req.user = decoded;
    next();
  } catch {
    return unauthorized(res);
  }
};
