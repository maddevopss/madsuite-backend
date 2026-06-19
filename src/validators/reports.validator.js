const { z } = require("zod");

const reportsQuerySchema = z.object({
  period: z.enum(["month", "quarter", "year"]).default("month"),
});

module.exports = {
  reportsQuerySchema,
};
