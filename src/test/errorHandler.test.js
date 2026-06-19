const errorHandler = require("../middleware/errorHandler");

describe("errorHandler middleware", () => {
  test("retourne 500 avec un message d'erreur", () => {
    const err = {
      message: "Je suis une théière",
    };

    const req = {
      method: "GET",
      originalUrl: "/test",
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "INTERNAL_SERVER_ERROR",
        data: null,
        errors: expect.objectContaining({
          message: "Je suis une théière",
        }),
      }),
    );
  });

  test("retourne 500 même sans message", () => {
    const err = {};

    const req = {
      method: "POST",
      originalUrl: "/test",
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "INTERNAL_SERVER_ERROR",
        errors: expect.objectContaining({
          message: "Erreur serveur",
        }),
      }),
    );
  });
});
