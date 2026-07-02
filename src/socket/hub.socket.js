// backend/src/socket/hub.socket.js

/**
 * Socket.io configuration for real‑time synchronization of the Smart Work‑Flow Hub.
 * The server instance is attached to the Express app in app.js (see note).
 *
 * SECURITY FIX (P0-3, P1-7):
 * - user.organisationId → user.organisation_id (JWT uses snake_case)
 * - Suppression du log du cookie complet (fuite de refresh_token)
 */

const jwt = require("jsonwebtoken");
const cookie = require("cookie");

function getAccessTokenFromSocket(socket) {
  if (socket.handshake.auth && socket.handshake.auth.token) {
    return socket.handshake.auth.token;
  }
  const cookieHeader = socket.handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    if (cookies.access_token) {
      return cookies.access_token;
    }
  }
  return null;
}

module.exports = (io) => {
  const hubNs = io.of("/hub");

  // Authentication Middleware
  hubNs.use((socket, next) => {
    const token = getAccessTokenFromSocket(socket);

    if (!token) {
      return next(new Error("Authentication error: Token manquant"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });

      if (decoded.token_type === "refresh") {
        return next(new Error("Authentication error: Token invalide ou expiré"));
      }

      socket.user = decoded;
      next();
    } catch (err) {
      // P1-7 fix: Ne pas logger le cookie complet (contient le refresh_token httpOnly)
      return next(new Error("Authentication error: Token invalide ou expiré"));
    }
  });

  hubNs.on("connection", (socket) => {
    const user = socket.user;

    // P0-3 fix: utiliser organisation_id (snake_case, cohérent avec le JWT)
    if (!user?.organisation_id) {
      return socket.disconnect(true);
    }

    const orgRoom = `org_${user.organisation_id}`;

    socket.join(orgRoom);

    socket.on("disconnect", () => {
      // Pas de log de données sensibles ici
    });

    socket.on("hub:timer:update", (payload) => {
      socket.to(orgRoom).emit("hub:timer:sync", payload);
    });

    socket.on("hub:timer:command", (payload) => {
      socket.to(orgRoom).emit("hub:timer:command", payload);
    });
  });

  // Helper to broadcast to all clients of an organisation
  const broadcast = (orgId, event, payload) => {
    const room = `org_${orgId}`;
    hubNs.to(room).emit(event, payload);
  };

  // Export broadcast so other services can use it
  return { broadcast };
};
