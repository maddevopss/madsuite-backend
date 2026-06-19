const {
  activityRuleSchema,
  updateActivityRuleSchema,
  classifyContextSchema,
  feedbackSchema,
} = require("../validators/activityIntelligence.validator");

describe("activityIntelligence.validator", () => {
  describe("activityRuleSchema", () => {
    test("accepte une règle valide complète", () => {
      const result = activityRuleSchema.safeParse({
        app_pattern: "Code",
        title_pattern: "MADSuite",
        category: "dev",
        tag: "backend",
        confidence: 90,
        is_productive: true,
        priority: 50,
        active: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.confidence).toBe(90);
    });

    test("applique les valeurs par défaut", () => {
      const result = activityRuleSchema.safeParse({
        app_pattern: "Chrome",
        category: "research",
      });

      expect(result.success).toBe(true);
      expect(result.data.confidence).toBe(70);
      expect(result.data.is_productive).toBe(true);
      expect(result.data.priority).toBe(10);
      expect(result.data.active).toBe(true);
    });

    test("refuse app_pattern vide", () => {
      const result = activityRuleSchema.safeParse({
        app_pattern: "",
        category: "dev",
      });

      expect(result.success).toBe(false);
    });

    test("refuse category trop courte", () => {
      const result = activityRuleSchema.safeParse({
        app_pattern: "Code",
        category: "x",
      });

      expect(result.success).toBe(false);
    });

    test("refuse confidence hors limites", () => {
      expect(
        activityRuleSchema.safeParse({
          app_pattern: "Code",
          category: "dev",
          confidence: -1,
        }).success,
      ).toBe(false);

      expect(
        activityRuleSchema.safeParse({
          app_pattern: "Code",
          category: "dev",
          confidence: 101,
        }).success,
      ).toBe(false);
    });

    test("refuse priority négative", () => {
      const result = activityRuleSchema.safeParse({
        app_pattern: "Code",
        category: "dev",
        priority: -1,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("updateActivityRuleSchema", () => {
    test("accepte un objet vide", () => {
      const result = updateActivityRuleSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    test("accepte une mise à jour partielle", () => {
      const result = updateActivityRuleSchema.safeParse({
        category: "meeting",
        active: false,
      });

      expect(result.success).toBe(true);
      expect(result.data.category).toBe("meeting");
      expect(result.data.active).toBe(false);
    });

    test("refuse une mise à jour invalide", () => {
      const result = updateActivityRuleSchema.safeParse({
        confidence: 200,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("classifyContextSchema", () => {
    test("accepte un body vide avec defaults", () => {
      const result = classifyContextSchema.safeParse({});

      expect(result.success).toBe(true);
      expect(result.data.currentActivity).toEqual({});
      expect(result.data.openWindows).toEqual([]);
    });

    test("accepte currentActivity valide", () => {
      const result = classifyContextSchema.safeParse({
        currentActivity: {
          app_name: "Code",
          window_title: "activityIntelligence.validator.js",
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.currentActivity.app_name).toBe("Code");
    });

    test("accepte openWindows avec formats Windows", () => {
      const result = classifyContextSchema.safeParse({
        openWindows: [
          {
            ProcessName: "Code",
            MainWindowTitle: "MADSuite",
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data.openWindows).toHaveLength(1);
    });

    test("refuse openWindows qui n'est pas un tableau", () => {
      const result = classifyContextSchema.safeParse({
        openWindows: "Code",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("feedbackSchema", () => {
    test("accepte un feedback confirmé complet", () => {
      const result = feedbackSchema.safeParse({
        activityLogId: 1,
        projet_id: 2,
        app_name: "Code",
        window_title: "MADSuite",
        confirmed_category: "dev",
        confirmed_tag: "backend",
        feedback_type: "confirmed",
      });

      expect(result.success).toBe(true);
      expect(result.data.feedback_type).toBe("confirmed");
    });

    test("applique feedback_type confirmed par défaut", () => {
      const result = feedbackSchema.safeParse({
        app_name: "Code",
      });

      expect(result.success).toBe(true);
      expect(result.data.feedback_type).toBe("confirmed");
    });

    test("accepte rejected et corrected", () => {
      expect(
        feedbackSchema.safeParse({
          feedback_type: "rejected",
        }).success,
      ).toBe(true);

      expect(
        feedbackSchema.safeParse({
          feedback_type: "corrected",
        }).success,
      ).toBe(true);
    });

    test("refuse feedback_type invalide", () => {
      const result = feedbackSchema.safeParse({
        feedback_type: "maybe",
      });

      expect(result.success).toBe(false);
    });

    test("refuse activityLogId négatif", () => {
      const result = feedbackSchema.safeParse({
        activityLogId: -1,
      });

      expect(result.success).toBe(false);
    });

    test("refuse projet_id zéro", () => {
      const result = feedbackSchema.safeParse({
        projet_id: 0,
      });

      expect(result.success).toBe(false);
    });
  });
});