const { z } = require("zod");

const createProjetSchema = z.object({
  nom: z.string().trim().min(2).max(100),
  client_id: z.number().int().positive(),
  description: z.string().trim().max(1000).optional().nullable(),
  date_fin: z.string().optional().nullable(),
  budget: z.number().min(0).max(10000000).optional().nullable(),
  budget_hours: z.number().min(0).max(100000).optional().nullable(),
  budget_amount: z.number().min(0).max(10000000).optional().nullable(),
  estimated_hours: z.number().min(0).max(100000).optional().nullable(),
  taux_horaire: z.number().min(0).max(10000).optional().nullable(),
  status: z.enum(["actif", "pause", "termine", "archive"]).optional().default("actif"),
  couleur: z.string().trim().max(50).optional().nullable(),
  billing_increment: z.number().int().min(1).max(60).optional().default(1),
  billing_rounding_type: z.enum(["exact", "up", "nearest"]).optional().default("exact"),
});

const updateProjetSchema = createProjetSchema.partial();

module.exports = { createProjetSchema, updateProjetSchema };
