const { z } = require("zod");

const createClientSchema = z.object({
  nom: z.string().min(2, "Nom trop court").max(100, "Nom trop long"),
  email: z.string().trim().email("Email invalide").max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable().or(z.literal('')),
  hourly_rate_defaut: z.number().min(0, "Le taux doit être positif").max(10000).optional().nullable(),
});

const updateClientSchema = z.object({
  nom: z.string().min(2).max(100).optional(),
  email: z.string().trim().email("Email invalide").max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable().or(z.literal('')),
  hourly_rate_defaut: z.number().min(0).optional(),
});

module.exports = {
  createClientSchema,
  updateClientSchema,
};
