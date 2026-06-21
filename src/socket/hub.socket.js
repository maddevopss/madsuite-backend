// backend/src/socket/hub.socket.js

/**
 * Socket.io configuration for real‑time synchronization of the Smart Work‑Flow Hub.
 * The server instance is attached to the Express app in app.js (see note).
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
      return next(new Error("Authentication error: Token invalide ou expiré"));
    }
    console.log("Socket auth failed:", {
      token: !!token,
      cookie: socket.handshake.headers.cookie,
    });
  });

  hubNs.on("connection", (socket) => {
    const user = socket.user;

    if (!user?.organisationId) {
      console.log("Missing organisationId, disconnecting");
      return socket.disconnect(true);
    }

    const orgRoom = `org_${user.organisationId}`;

    console.log(`Hub socket connected: user ${user.id}, org ${user.organisationId}`);

    socket.join(orgRoom);

    socket.on("disconnect", () => {
      console.log("Hub socket disconnected");
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
