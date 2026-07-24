const { z } = require("zod");

const activityTypes = ["call", "email", "meeting", "note", "task"];
const taskStatuses = ["pending", "completed", "cancelled"];

const nullablePositiveInt = z.coerce.number().int().positive().nullable().optional();
const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const nullableDateTime = z.string().datetime({ offset: true }).nullable().optional();

const activityIdSchema = z.coerce.number().int().positive();

const listActivitiesQuerySchema = z.object({
  lead_id: z.coerce.number().int().positive().optional(),
  opportunity_id: z.coerce.number().int().positive().optional(),
  activity_type: z.enum(activityTypes).optional(),
  task_status: z.enum(taskStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().refine((value) => !(value.lead_id && value.opportunity_id), {
  message: "Les filtres prospect et opportunité ne peuvent pas être combinés.",
});

const activityFieldsSchema = z.object({
  lead_id: nullablePositiveInt,
  opportunity_id: nullablePositiveInt,
  activity_type: z.enum(activityTypes),
  task_status: z.enum(taskStatuses).nullable().optional(),
  subject: z.string().trim().min(1).max(255),
  details: nullableText(5000),
  due_at: nullableDateTime,
  completed_at: nullableDateTime,
}).strict();

const createActivitySchema = activityFieldsSchema
  .refine((value) => Boolean(value.lead_id) !== Boolean(value.opportunity_id), {
    message: "Une activité doit être liée à un prospect ou à une opportunité, mais pas aux deux.",
  })
  .refine((value) => value.activity_type === "task" || value.task_status == null, {
    message: "Un statut de tâche est permis uniquement pour une activité de type tâche.",
  });

const updateActivitySchema = activityFieldsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Aucune mise à jour d'activité fournie.",
  })
  .refine((value) => !(value.lead_id != null && value.opportunity_id != null), {
    message: "Une activité ne peut pas être liée simultanément à un prospect et une opportunité.",
  })
  .refine((value) => value.activity_type === "task" || value.task_status == null, {
    message: "Un statut de tâche est permis uniquement pour une activité de type tâche.",
  });

function parseOrThrow(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const error = new Error("Données d'activité invalides.");
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.details = result.error.flatten();
  throw error;
}

module.exports = {
  activityIdSchema,
  activityTypes,
  createActivitySchema,
  listActivitiesQuerySchema,
  parseOrThrow,
  taskStatuses,
  updateActivitySchema,
};
