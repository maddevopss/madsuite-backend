const apiResponseMiddleware = require("../middleware/apiResponse");

function createResponse(statusCode = 200) {
  const res = {
    statusCode,
    json: jest.fn((body) => body),
  };
  return res;
}

describe("apiResponseMiddleware", () => {
  test("enveloppe une reponse de succes legacy", () => {
    const req = { baseUrl: "/api/clients" };
    const res = createResponse();
    const originalJson = res.json;

    apiResponseMiddleware(req, res, jest.fn());
    res.json([{ id: 1 }]);

    expect(originalJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        code: "API_CLIENTS_OK",
        data: [{ id: 1 }],
        timestamp: expect.any(String),
      }),
    );
  });

  test("enveloppe une erreur legacy", () => {
    const req = { baseUrl: "/api/clients" };
    const res = createResponse(404);
    const originalJson = res.json;

    apiResponseMiddleware(req, res, jest.fn());
    res.json({ message: "Client introuvable" });

    expect(originalJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "API_CLIENTS_FAILED",
        data: null,
        errors: { message: "Client introuvable" },
      }),
    );
  });

  test("ne double-enveloppe pas une ApiResponse", () => {
    const body = {
      success: true,
      code: "TIMER_STARTED",
      data: { id: 1 },
      timestamp: new Date().toISOString(),
    };
    const req = { baseUrl: "/api/timer" };
    const res = createResponse();
    const originalJson = res.json;

    apiResponseMiddleware(req, res, jest.fn());
    res.json(body);

    expect(originalJson).toHaveBeenCalledWith(body);
  });
});
