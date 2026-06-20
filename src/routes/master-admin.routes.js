const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");
const auth = require("../middleware/auth");
const { createClientOrganisation } = require("../services/masteradmin.service");
const { z } = require("zod");

// Middleware to restrict access to user ID 1
const requireMasterAdmin = (req, res, next) => {
  if (req.user && req.user.id === 1) {
    return next();
  }
  return res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Accès réservé au Master Admin." }));
};

const createOrgSchema = z.object({
  organisation_nom: z.string().min(2, "Nom d'organisation requis"),
  user_nom: z.string().min(2, "Nom d'utilisateur requis"),
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "Mot de passe min 8 caractères"),
});

router.use(auth);
router.use(requireMasterAdmin);

router.post("/organisations", async (req, res, next) => {
  try {
    const parsed = createOrgSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const result = await createClientOrganisation(parsed.data);

    return res.status(201).json(ApiResponse.success("ORGANISATION_CREATED", result));
  } catch (err) {
    if (err.message === "Cet email est déjà utilisé.") {
      return res.status(409).json(ApiResponse.error("CONFLICT", { message: err.message }));
    }
    next(err);
  }
});

module.exports = router;
