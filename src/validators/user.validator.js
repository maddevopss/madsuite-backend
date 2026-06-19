const { z } = require("zod");

const roleSchema = z.enum(["admin", "employe"]);
const passwordSchema = z
  .string()
  .trim()
  .min(12, "Le mot de passe doit contenir au moins 12 caracteres.")
  .max(100)
  .regex(/[a-z]/, "Le mot de passe doit contenir une minuscule.")
  .regex(/[A-Z]/, "Le mot de passe doit contenir une majuscule.")
  .regex(/[0-9]/, "Le mot de passe doit contenir un chiffre.")
  .regex(/[^A-Za-z0-9]/, "Le mot de passe doit contenir un caractere special.");

const createUserSchema = z
  .object({
    nom: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(255).optional(), // Optional for kiosk
    password: passwordSchema.optional(),
    mot_de_passe: passwordSchema.optional(),
    role: roleSchema.default("employe"),
    is_kiosk_user: z.boolean().default(false),
    pin: z.string().regex(/^\d{4}$/, "Le NIP doit contenir exactement 4 chiffres.").optional(),
  })
  .refine((data) => data.is_kiosk_user || data.password || data.mot_de_passe, {
    message: "Mot de passe requis pour les utilisateurs standards.",
    path: ["mot_de_passe"],
  })
  .refine((data) => !data.is_kiosk_user || data.pin, {
    message: "Le NIP est requis pour les utilisateurs kiosque.",
    path: ["pin"],
  });

const updateUserSchema = z.object({
  nom: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(255).optional(),
  role: roleSchema.optional(),
  is_kiosk_user: z.boolean().optional(),
  pin: z.string().regex(/^\d{4}$/, "Le NIP doit contenir exactement 4 chiffres.").optional(),
});

const updatePasswordSchema = z
  .object({
    password: passwordSchema.optional(),
    mot_de_passe: passwordSchema.optional(),
  })
  .refine((data) => data.password || data.mot_de_passe, {
    message: "Nouveau mot de passe requis.",
    path: ["mot_de_passe"],
  });

module.exports = {
  createUserSchema,
  updateUserSchema,
  updatePasswordSchema,
};
