const { z } = require("zod");

const activityRuleSchema = z.object({
  app_pattern: z.string().trim().min(1).max(255),
  title_pattern: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().min(2).max(80),
  tag: z.string().trim().max(80).optional().nullable(),
  confidence: z.number().int().min(0).max(100).optional().default(70),
  is_productive: z.boolean().optional().default(true),
  priority: z.number().int().min(0).max(1000).optional().default(10),
  active: z.boolean().optional().default(true),
});

const updateActivityRuleSchema = activityRuleSchema.partial();

const classifyContextSchema = z.object({
  currentActivity: z
    .object({
      app_name: z.string().trim().max(255).optional().default(""),
      window_title: z.string().trim().max(1000).optional().default(""),
    })
    .optional()
    .default({}),
  openWindows: z
    .array(
      z.object({
        app_name: z.string().trim().max(255).optional().default(""),
        window_title: z.string().trim().max(1000).optional().default(""),
        ProcessName: z.string().trim().max(255).optional(),
        MainWindowTitle: z.string().trim().max(1000).optional(),
      }),
    )
    .optional()
    .default([]),
});

const feedbackSchema = z.object({
  activityLogId: z.number().int().positive().optional().nullable(),
  projet_id: z.number().int().positive().optional().nullable(),
  app_name: z.string().trim().max(255).optional().default(""),
  window_title: z.string().trim().max(1000).optional().default(""),
  confirmed_category: z.string().trim().max(80).optional().nullable(),
  confirmed_tag: z.string().trim().max(80).optional().nullable(),
  feedback_type: z.enum(["confirmed", "rejected", "corrected"]).optional().default("confirmed"),
});

module.exports = {
  activityRuleSchema,
  updateActivityRuleSchema,
  classifyContextSchema,
  feedbackSchema,
};
