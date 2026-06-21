const jwt = require("jsonwebtoken");
const socketIO = require("socket.io");

/**
 * Socket.IO Configuration
 * Real-time updates for:
 * - Active timers (start/pause/resume)
 * - Live activity logs
 * - Invoice generation progress
 */

function configureSocket(server) {
  const io = socketIO(server, {
    cors: {
      origin: process.env.FRONTEND_URL,
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  // Middleware: Authenticate with JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Missing token"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.sub;
      socket.organisationId = decoded.org_id;
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  // Connection event
  io.on("connection", (socket) => {
    console.log(`User ${socket.userId} connected`);

    // Join org-specific room
    socket.join(`org:${socket.organisationId}`);

    // Timer started
    socket.on("timer:start", (data) => {
      io.to(`org:${socket.organisationId}`).emit("timer:updated", {
        userId: socket.userId,
        projectId: data.projectId,
        status: "running",
      });
    });

    // Timer paused
    socket.on("timer:pause", (data) => {
      io.to(`org:${socket.organisationId}`).emit("timer:updated", {
        userId: socket.userId,
        status: "paused",
      });
    });

    // Activity log received
    socket.on("activity:logged", (data) => {
      // Broadcast to all users in org (for real-time dashboards)
      io.to(`org:${socket.organisationId}`).emit("activity:new", {
        userId: socket.userId,
        app: data.app_name,
      });
    });

    socket.on("disconnect", () => {
      console.log(`User ${socket.userId} disconnected`);
    });
  });

  return io;
}

module.exports = configureSocket;
