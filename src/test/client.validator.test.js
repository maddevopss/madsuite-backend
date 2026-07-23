const { createClientSchema, updateClientSchema } = require("../validators/client.validator");

describe("Client Validator", () => {
  describe("createClientSchema", () => {
    test("accepte un taux numérique valide", () => {
      const data = {
        nom: "Client Test",
        hourly_rate_defaut: 85,
      };
      const result = createClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBe(85);
    });

    test("accepte un taux de 0", () => {
      const data = {
        nom: "Client Test",
        hourly_rate_defaut: 0,
      };
      const result = createClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBe(0);
    });

    test("accepte un taux null", () => {
      const data = {
        nom: "Client Test",
        hourly_rate_defaut: null,
      };
      const result = createClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBeNull();
    });

    test("rejette un taux supérieur à 10000", () => {
      const data = {
        nom: "Client Test",
        hourly_rate_defaut: 10001,
      };
      const result = createClientSchema.safeParse(data);
      expect(result.success).toBe(false);
      expect(result.error.flatten().fieldErrors.hourly_rate_defaut).toBeDefined();
    });

    test("rejette une chaîne brute non convertie", () => {
      const data = {
        nom: "Client Test",
        hourly_rate_defaut: "85",
      };
      const result = createClientSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    test("rejette un taux négatif", () => {
      const data = {
        nom: "Client Test",
        hourly_rate_defaut: -5,
      };
      const result = createClientSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe("updateClientSchema", () => {
    test("accepte un taux numérique valide", () => {
      const data = {
        hourly_rate_defaut: 85,
      };
      const result = updateClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBe(85);
    });

    test("accepte un taux de 0", () => {
      const data = {
        hourly_rate_defaut: 0,
      };
      const result = updateClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBe(0);
    });

    test("accepte un taux null", () => {
      const data = {
        hourly_rate_defaut: null,
      };
      const result = updateClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBeNull();
    });

    test("accepte un objet sans hourly_rate_defaut (optionnel)", () => {
      const data = {
        nom: "Client Updated",
      };
      const result = updateClientSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.hourly_rate_defaut).toBeUndefined();
    });

    test("rejette un taux supérieur à 10000", () => {
      const data = {
        hourly_rate_defaut: 10001,
      };
      const result = updateClientSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    test("rejette une chaîne brute non convertie", () => {
      const data = {
        hourly_rate_defaut: "85",
      };
      const result = updateClientSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    test("harmonise avec createClientSchema pour les champs communs", () => {
      const createData = {
        nom: "Client Test",
        hourly_rate_defaut: 85,
      };
      const updateData = {
        hourly_rate_defaut: 85,
      };

      const createResult = createClientSchema.safeParse(createData);
      const updateResult = updateClientSchema.safeParse(updateData);

      expect(createResult.success).toBe(true);
      expect(updateResult.success).toBe(true);
      expect(createResult.data.hourly_rate_defaut).toBe(updateResult.data.hourly_rate_defaut);
    });
  });
});
