const { z } = require("zod");

const startTimerSchema = z.object({
  projet_id: z.coerce.number().int().positive(),
  description: z.string().trim().max(1000).optional().nullable(),
});

module.exports = {
  startTimerSchema,
};
