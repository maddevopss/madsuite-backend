// backend/src/socket/hub.socket.js

/**
 * Socket.io configuration for real‑time synchronization of the Smart Work‑Flow Hub.
 * The server instance is attached to the Express app in app.js (see note).
 */

module.exports = (io) => {
  // Namespace for hub events (optional, could use default)
  const hubNs = io.of('/hub');

  hubNs.on('connection', (socket) => {
    const user = socket.handshake.query; // expect organisationId from client auth token
    console.log(`Hub socket connected: user ${user.id}, org ${user.organisationId}`);

    // Join room per organisation to isolate events
    const orgRoom = `org_${user.organisationId}`;
    socket.join(orgRoom);

    // Listen for client‑initiated events if needed
    socket.on('disconnect', () => {
      console.log('Hub socket disconnected');
    });

    // Timer synchronization
    socket.on('hub:timer:update', (payload) => {
      // payload: { isRunning, seconds }
      // Broadcast to all other clients in the same organization
      socket.to(orgRoom).emit('hub:timer:sync', payload);
    });

    socket.on('hub:timer:command', (payload) => {
      // payload: { action: 'start' | 'stop' }
      socket.to(orgRoom).emit('hub:timer:command', payload);
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
