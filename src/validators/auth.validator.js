const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().trim().email("Email invalide").max(255),
  password: z.string().min(1, "Mot de passe requis").max(100),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token requis"),
});

const signupSchema = z.object({
  organisation_nom: z.string().min(2, "Nom d'organisation requis (min 2 caractères)").max(255),
  user_nom: z.string().min(2, "Nom d'utilisateur requis").max(255),
  email: z.string().trim().email("Email invalide").max(255),
  password: z.string().min(12, "Le mot de passe doit contenir au moins 12 caractères").regex(/[A-Z]/, "Le mot de passe doit contenir une majuscule").regex(/[^A-Za-z0-9]/, "Le mot de passe doit contenir un caractère spécial").max(100),
});

module.exports = {
  loginSchema,
  refreshTokenSchema,
  signupSchema,
};
