const { z } = require("zod");

const opportunityStatuses = ["open", "qualified", "proposal", "negotiation", "won", "lost", "abandoned"];
const nullablePositiveInt = z.coerce.number().int().positive().nullable().optional();
const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const nullableMoney = z.coerce.number().min(0).max(999999999999.99).nullable().optional();
const nullableProbability = z.coerce.number().int().min(0).max(100).nullable().optional();
const nullableDate = z.string().date().nullable().optional();

const opportunityIdSchema = z.coerce.number().int().positive();

const listOpportunitiesQuerySchema = z.object({
  status: z.enum(opportunityStatuses).optional(),
  owner_user_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const createOpportunitySchema = z.object({
  lead_id: nullablePositiveInt,
  client_id: nullablePositiveInt,
  owner_user_id: nullablePositiveInt,
  title: z.string().trim().min(1).max(255),
  description: nullableText(5000),
  estimated_value: nullableMoney,
  probability: nullableProbability,
  expected_close_date: nullableDate,
}).strict().refine((value) => value.lead_id || value.client_id, {
  message: "Un prospect ou un client est requis.",
});

const updateOpportunitySchema = createOpportunitySchema.partial().extend({
  status: z.enum(opportunityStatuses).optional(),
  lost_reason: nullableText(2000),
  abandoned_reason: nullableText(2000),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Aucune mise à jour d'opportunité fournie.",
});

function parseOrThrow(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const error = new Error("Données d'opportunité invalides.");
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.details = result.error.flatten();
  throw error;
}

module.exports = {
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdSchema,
  opportunityStatuses,
  parseOrThrow,
  updateOpportunitySchema,
};