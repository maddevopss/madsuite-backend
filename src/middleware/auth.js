// Middleware d'authentification pour protéger les routes
const jwt = require("jsonwebtoken");

function getAccessToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  return req.cookies?.access_token || null;
}

// Vérifie le token JWT dans les requêtes protégées
module.exports = (req, res, next) => {
  const token = getAccessToken(req);

  if (!token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (decoded.token_type === "refresh") {
      return res.status(401).json({ message: "Token invalide ou expiré" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalide ou expiré" });
  }
};
