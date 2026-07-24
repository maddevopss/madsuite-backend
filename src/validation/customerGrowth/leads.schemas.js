const { z } = require("zod");

const leadStatuses = ["new", "contacted", "qualified", "unqualified", "archived"];

const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const nullablePositiveInt = z.coerce.number().int().positive().nullable().optional();

const leadIdSchema = z.coerce.number().int().positive();

const listLeadsQuerySchema = z.object({
  status: z.enum(leadStatuses).optional(),
  owner_user_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const createLeadSchema = z.object({
  display_name: z.string().trim().min(1).max(255),
  company_name: nullableText(255),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: nullableText(64),
  source: nullableText(100),
  notes: nullableText(5000),
  owner_user_id: nullablePositiveInt,
}).strict();

const updateLeadSchema = createLeadSchema.partial().extend({
  status: z.enum(leadStatuses).optional(),
  unqualified_reason: nullableText(2000),
  archived_reason: nullableText(2000),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Aucune mise à jour de prospect fournie.",
});

function parseOrThrow(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const error = new Error("Données de prospect invalides.");
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.details = result.error.flatten();
  throw error;
}

module.exports = {
  createLeadSchema,
  leadIdSchema,
  leadStatuses,
  listLeadsQuerySchema,
  parseOrThrow,
  updateLeadSchema,
};
