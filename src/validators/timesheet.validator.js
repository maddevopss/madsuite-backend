const { z } = require("zod");

const createTimesheetSchema = z.object({
  projet_id: z.number().int().positive(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().nullable().optional(),
  description: z.string().max(1000).optional(),
  distance_km: z.number().min(0).max(5000).optional(),
});

const updateTimesheetSchema = z.object({
  projet_id: z.number().int().positive().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().nullable().optional(),
  description: z.string().max(1000).optional(),
  distance_km: z.number().min(0).max(5000).optional(),
});

module.exports = {
  createTimesheetSchema,
  updateTimesheetSchema,
};
