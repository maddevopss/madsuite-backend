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

const MAX_SOCKET_PAYLOAD_BYTES = 4096;
const TIMER_RELAY_FIELDS = new Set(["timerId", "projectId", "status", "startedAt", "stoppedAt", "elapsedSeconds", "description"]);
const TIMER_COMMAND_FIELDS = new Set(["command", "timerId", "projectId", "description"]);
const ALLOWED_TIMER_COMMANDS = new Set(["start", "stop", "pause", "resume", "sync"]);

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

function payloadSize(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload || {}), "utf8");
  } catch (err) {
    return MAX_SOCKET_PAYLOAD_BYTES + 1;
  }
}

function pickAllowedFields(payload, allowedFields) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payloadSize(payload) > MAX_SOCKET_PAYLOAD_BYTES) return null;

  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => allowedFields.has(key)),
  );
}

function sanitizeTimerUpdatePayload(payload) {
  return pickAllowedFields(payload, TIMER_RELAY_FIELDS);
}

function sanitizeTimerCommandPayload(payload) {
  const safePayload = pickAllowedFields(payload, TIMER_COMMAND_FIELDS);
  if (!safePayload) return null;
  if (!ALLOWED_TIMER_COMMANDS.has(safePayload.command)) return null;
  return safePayload;
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
      const safePayload = sanitizeTimerUpdatePayload(payload);
      if (!safePayload) return;
      socket.to(orgRoom).emit("hub:timer:sync", safePayload);
    });

    socket.on("hub:timer:command", (payload) => {
      const safePayload = sanitizeTimerCommandPayload(payload);
      if (!safePayload) return;
      socket.to(orgRoom).emit("hub:timer:command", safePayload);
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
