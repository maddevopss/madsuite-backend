# Real-Time Features

Currently using polling + HTTP long-polling.

For future real-time features (live timers, activity):
**-** Consider Socket.IO setup in **`src/config/socket.js`**
**-** Alternative: Server-Sent Events (SSE) for better compatibility

# Socket.IO Implementation Guide

## Status: [IMPLEMENTED | NOT IMPLEMENTED | PLANNED]

### Current Usage

- [x/✗] Real-time timer updates
- [x/✗] Live activity logging
- [x/✗] Dashboard updates
- [x/✗] Invoice progress

### Setup (if needed)

```bash
npm install socket.io
```

### Rooms Structure

- `org:${organisationId}` — All users in organisation
- `user:${userId}:timers` — User's timer events
- `user:${userId}:activity` — User's activity logs

### Events

**Client → Server:**

- `timer:start` — Start timer
- `timer:pause` — Pause timer
- `activity:logged` — Activity received
- `typing:user-activity` — Real-time activity update

**Server → Client:**

- `timer:updated` — Timer state changed
- `activity:new` — New activity from org
- `notification` — Server notification

### Authentication

Uses JWT from socket handshake:

```javascript
socket.handshake.auth.token;
```

### Testing

```bash
npm test -- socket.test.js
```
