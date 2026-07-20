const jwt = require("jsonwebtoken");

const registerHubSocket = require("../socket/hub.socket");

function makeToken(overrides = {}) {
  return jwt.sign(
    {
      id: 100,
      email: "socket-proof@example.com",
      role: "admin",
      token_type: "access",
      ...overrides,
    },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" },
  );
}

class FakeSocket {
  constructor(namespace, { token, cookie } = {}) {
    this.namespace = namespace;
    this.handshake = {
      auth: token ? { token } : {},
      headers: cookie ? { cookie } : {},
    };
    this.handlers = new Map();
    this.received = [];
    this.rooms = new Set();
    this.disconnected = false;
    this.user = null;
  }

  join(room) {
    this.rooms.add(room);
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  to(room) {
    return {
      emit: (event, payload) => {
        for (const socket of this.namespace.sockets) {
          if (socket !== this && socket.rooms.has(room) && !socket.disconnected) {
            socket.received.push({ event, payload });
          }
        }
      },
    };
  }

  emitFromClient(event, payload) {
    const handler = this.handlers.get(event);
    if (handler) handler(payload);
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeNamespace {
  constructor() {
    this.middleware = null;
    this.connectionHandler = null;
    this.sockets = [];
    this.broadcasts = [];
  }

  use(handler) {
    this.middleware = handler;
  }

  on(event, handler) {
    if (event === "connection") this.connectionHandler = handler;
  }

  to(room) {
    return {
      emit: (event, payload) => {
        this.broadcasts.push({ room, event, payload });
        for (const socket of this.sockets) {
          if (socket.rooms.has(room) && !socket.disconnected) {
            socket.received.push({ event, payload });
          }
        }
      },
    };
  }

  async connect(socket) {
    await new Promise((resolve, reject) => {
      this.middleware(socket, (err) => (err ? reject(err) : resolve()));
    });
    this.sockets.push(socket);
    this.connectionHandler(socket);
    return socket;
  }
}

function createHarness() {
  const namespace = new FakeNamespace();
  const io = {
    of: jest.fn((name) => {
      expect(name).toBe("/hub");
      return namespace;
    }),
  };
  const api = registerHubSocket(io);
  return { namespace, api };
}

describe("P0 — isolation Socket.IO entre organisations", () => {
  test("une mise à jour de A atteint les autres sockets de A, jamais B", async () => {
    const { namespace } = createHarness();
    const tokenA1 = makeToken({ id: 101, organisation_id: 10 });
    const tokenA2 = makeToken({ id: 102, organisation_id: 10 });
    const tokenB = makeToken({ id: 201, organisation_id: 20 });

    const socketA1 = await namespace.connect(new FakeSocket(namespace, { token: tokenA1 }));
    const socketA2 = await namespace.connect(new FakeSocket(namespace, { token: tokenA2 }));
    const socketB = await namespace.connect(new FakeSocket(namespace, { token: tokenB }));

    socketA1.emitFromClient("hub:timer:update", {
      timerId: 777,
      projectId: 42,
      status: "running",
      description: "preuve A",
      organisation_id: 20,
      secret: "ne doit jamais sortir",
    });

    expect(socketA1.received).toEqual([]);
    expect(socketA2.received).toEqual([
      {
        event: "hub:timer:sync",
        payload: {
          timerId: 777,
          projectId: 42,
          status: "running",
          description: "preuve A",
        },
      },
    ]);
    expect(socketB.received).toEqual([]);
    expect(socketA1.rooms).toEqual(new Set(["org_10"]));
    expect(socketA2.rooms).toEqual(new Set(["org_10"]));
    expect(socketB.rooms).toEqual(new Set(["org_20"]));
  });

  test("une commande de B ne traverse jamais vers A", async () => {
    const { namespace } = createHarness();
    const socketA = await namespace.connect(
      new FakeSocket(namespace, { token: makeToken({ id: 103, organisation_id: 10 }) }),
    );
    const socketB1 = await namespace.connect(
      new FakeSocket(namespace, { token: makeToken({ id: 202, organisation_id: 20 }) }),
    );
    const socketB2 = await namespace.connect(
      new FakeSocket(namespace, { token: makeToken({ id: 203, organisation_id: 20 }) }),
    );

    socketB1.emitFromClient("hub:timer:command", {
      command: "stop",
      timerId: 888,
      projectId: 55,
      role: "superadmin",
    });

    expect(socketA.received).toEqual([]);
    expect(socketB1.received).toEqual([]);
    expect(socketB2.received).toEqual([
      {
        event: "hub:timer:command",
        payload: {
          command: "stop",
          timerId: 888,
          projectId: 55,
        },
      },
    ]);
  });

  test("le helper broadcast cible uniquement la salle de l’organisation demandée", async () => {
    const { namespace, api } = createHarness();
    const socketA = await namespace.connect(
      new FakeSocket(namespace, { token: makeToken({ id: 104, organisation_id: 10 }) }),
    );
    const socketB = await namespace.connect(
      new FakeSocket(namespace, { token: makeToken({ id: 204, organisation_id: 20 }) }),
    );

    api.broadcast(10, "invoice:created", { invoiceId: 999 });

    expect(socketA.received).toEqual([
      { event: "invoice:created", payload: { invoiceId: 999 } },
    ]);
    expect(socketB.received).toEqual([]);
    expect(namespace.broadcasts).toEqual([
      {
        room: "org_10",
        event: "invoice:created",
        payload: { invoiceId: 999 },
      },
    ]);
  });

  test("un refresh token est refusé et un JWT sans organisation est déconnecté", async () => {
    const { namespace } = createHarness();
    const refreshToken = makeToken({ token_type: "refresh", organisation_id: 10 });

    await expect(
      namespace.connect(new FakeSocket(namespace, { token: refreshToken })),
    ).rejects.toThrow("Authentication error: Token invalide ou expiré");

    const noOrganisation = await namespace.connect(
      new FakeSocket(namespace, { token: makeToken({ id: 999 }) }),
    );

    expect(noOrganisation.disconnected).toBe(true);
    expect(noOrganisation.rooms.size).toBe(0);
  });
});
