const { z } = require("zod");

const createActivitySchema = z.object({
  app_name: z.string().trim().min(1).max(255),
  window_title: z.string().trim().max(1000).optional().default(""),
  duration_seconds: z.number().int().min(0).max(86400),
  is_idle: z.boolean().optional().default(false),
  idle_seconds: z.number().int().min(0).max(86400).optional().default(0),
  activity_signature: z.string().trim().max(500).optional().nullable(),
  // type n'est pas exposé au client — il est fixé par la route elle-même
});

const updateActivityDurationSchema = z.object({
  duration_seconds: z.number().int().min(0).max(86400),
  is_idle: z.boolean().optional().default(false),
  idle_seconds: z.number().int().min(0).max(86400).optional().default(0),
});

const createWindowLogsSchema = z.object({
  windows: z.array(
    z.object({
      ProcessName: z.string().trim().min(1).max(255).optional(),
      MainWindowTitle: z.string().trim().max(1000).optional(),
    }),
  ),
  duration_seconds: z.number().int().min(0).max(86400),
  is_idle: z.boolean().optional().default(false),
  idle_seconds: z.number().int().min(0).max(86400).optional().default(0),
});

const batchEventSchema = z.object({
  kind: z.enum(["activity_post", "activity_windows_post", "activity_duration_patch"]),
  payload: z.any(),
});

const batchEventsSchema = z.object({
  events: z.array(batchEventSchema).max(200),
});

module.exports = {
  createActivitySchema,
  updateActivityDurationSchema,
  createWindowLogsSchema,
  batchEventSchema,
  batchEventsSchema,
};
