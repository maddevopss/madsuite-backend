const ApiResponse = require("../utils/apiResponse");

describe("ApiResponse", () => {
  test("cree une reponse de succes standardisee", () => {
    const response = ApiResponse.success("CLIENT_LISTED", [{ id: 1 }]);
    const json = response.toJSON();

    expect(json).toEqual({
      success: true,
      code: "CLIENT_LISTED",
      data: [{ id: 1 }],
      timestamp: expect.any(String),
    });
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
  });

  test("cree une reponse d'erreur standardisee", () => {
    const response = ApiResponse.error("VALIDATION_ERROR", {
      message: "Donnees invalides.",
      fieldErrors: { email: ["Email invalide."] },
    });

    expect(response.toJSON()).toEqual({
      success: false,
      code: "VALIDATION_ERROR",
      data: null,
      timestamp: expect.any(String),
      errors: {
        message: "Donnees invalides.",
        fieldErrors: { email: ["Email invalide."] },
      },
    });
  });

  test("omet errors lorsqu'il est absent", () => {
    expect(ApiResponse.success("NO_CONTENT").toJSON()).not.toHaveProperty("errors");
    expect(ApiResponse.error("UNKNOWN").toJSON()).not.toHaveProperty("errors");
  });

  test("JSON.stringify utilise toJSON", () => {
    const parsed = JSON.parse(JSON.stringify(ApiResponse.success("OK", { ready: true })));

    expect(parsed).toMatchObject({
      success: true,
      code: "OK",
      data: { ready: true },
    });
  });
});
