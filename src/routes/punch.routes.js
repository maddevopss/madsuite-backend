const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../../db");
const ApiResponse = require("../utils/apiResponse");
const { z } = require("zod");
const { requireModuleForOrg } = require("../middleware/requireModule");

// Validator for kiosk token
const kioskTokenSchema = z.string().min(10);

async function getOrgByKioskToken(kioskToken) {
  const result = await db.query(
    "SELECT id, nom FROM organisations WHERE kiosk_token = $1",
    [kioskToken]
  );
  return result.rows[0];
}

async function verifyKioskUser(organisationId, utilisateurId, pin) {
  const result = await db.query(
    "SELECT id, pin_hash FROM utilisateurs WHERE id = $1 AND organisation_id = $2 AND is_kiosk_user = true AND deleted_at IS NULL",
    [utilisateurId, organisationId]
  );
  const user = result.rows[0];
  if (!user || !user.pin_hash) return false;
  return await bcrypt.compare(pin, user.pin_hash);
}

async function hasOrgModule(organisationId, moduleKey) {
  return await requireModuleForOrg(moduleKey, organisationId)();
}

async function ensureAnyKioskModule(org) {
  const hasPunch = await hasOrgModule(org.id, "kiosk_punch");
  const hasKm = await hasOrgModule(org.id, "kiosk_km");
  return hasPunch || hasKm;
}

async function ensureKioskModule(res, org, moduleKey) {
  const hasAccess = await hasOrgModule(org.id, moduleKey);
  if (hasAccess) return true;

  res.status(403).json(ApiResponse.error("MODULE_NOT_ENABLED", {
    message: `Le module "${moduleKey}" n'est pas activé pour votre organisation.`,
    module_key: moduleKey
  }));
  return false;
}

// 1. Get Kiosk Info
router.get("/kiosk/:kiosk_token", async (req, res) => {
  try {
    const parsedToken = kioskTokenSchema.safeParse(req.params.kiosk_token);
    if (!parsedToken.success) {
      return res.status(400).json(ApiResponse.error("BAD_REQUEST", { message: "Token kiosque invalide" }));
    }

    const org = await getOrgByKioskToken(parsedToken.data);
    if (!org) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Kiosque introuvable" }));
    }

    if (!(await ensureAnyKioskModule(org))) {
      return res.status(403).json(ApiResponse.error("MODULE_NOT_ENABLED", {
        message: "Aucun module kiosque n'est activé pour votre organisation.",
      }));
    }

    const usersRes = await db.query(
      "SELECT id, nom FROM utilisateurs WHERE organisation_id = $1 AND is_kiosk_user = true AND deleted_at IS NULL ORDER BY nom ASC",
      [org.id]
    );

    const projetsRes = await db.query(
      "SELECT id, nom FROM projets WHERE organisation_id = $1 AND status = 'actif' AND deleted_at IS NULL ORDER BY nom ASC",
      [org.id]
    );

    return res.status(200).json(ApiResponse.success("KIOSK_INFO", {
      organisation: { id: org.id, nom: org.nom },
      employes: usersRes.rows,
      projets: projetsRes.rows
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

// 2. Get Employee Status (Active Timer?)
router.post("/status", async (req, res) => {
  try {
    const { kiosk_token, utilisateur_id, pin } = req.body;
    if (!kiosk_token || !utilisateur_id || !pin) {
      return res.status(400).json(ApiResponse.error("BAD_REQUEST", { message: "Donnees manquantes" }));
    }

    const org = await getOrgByKioskToken(kiosk_token);
    if (!org) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Kiosque introuvable" }));
    if (!(await ensureKioskModule(res, org, "kiosk_punch"))) return;

    const isValid = await verifyKioskUser(org.id, utilisateur_id, pin);
    if (!isValid) return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));

    const activeTimer = await db.query(
      "SELECT id, start_time, projet_id FROM time_entries WHERE utilisateur_id = $1 AND end_time IS NULL AND deleted_at IS NULL",
      [utilisateur_id]
    );

    return res.status(200).json(ApiResponse.success("STATUS", {
      active_timer: activeTimer.rows[0] || null
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

// 3. Punch IN
router.post("/in", async (req, res) => {
  try {
    const { kiosk_token, utilisateur_id, pin, projet_id } = req.body;
    if (!kiosk_token || !utilisateur_id || !pin || !projet_id) {
      return res.status(400).json(ApiResponse.error("BAD_REQUEST", { message: "Donnees manquantes" }));
    }

    const org = await getOrgByKioskToken(kiosk_token);
    if (!org) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Kiosque introuvable" }));
    if (!(await ensureKioskModule(res, org, "kiosk_punch"))) return;

    const isValid = await verifyKioskUser(org.id, utilisateur_id, pin);
    if (!isValid) return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));

    // Stop any active timer first
    await db.query(
      "UPDATE time_entries SET end_time = NOW() WHERE utilisateur_id = $1 AND end_time IS NULL AND deleted_at IS NULL",
      [utilisateur_id]
    );

    // Create new timer
    const newTimer = await db.query(
      "INSERT INTO time_entries (utilisateur_id, projet_id, organisation_id, start_time) VALUES ($1, $2, $3, NOW()) RETURNING id, start_time",
      [utilisateur_id, projet_id, org.id]
    );

    return res.status(200).json(ApiResponse.success("PUNCHED_IN", {
      timer: newTimer.rows[0]
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

// 4. Punch OUT
router.post("/out", async (req, res) => {
  try {
    const { kiosk_token, utilisateur_id, pin } = req.body;
    if (!kiosk_token || !utilisateur_id || !pin) {
      return res.status(400).json(ApiResponse.error("BAD_REQUEST", { message: "Donnees manquantes" }));
    }

    const org = await getOrgByKioskToken(kiosk_token);
    if (!org) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Kiosque introuvable" }));
    if (!(await ensureKioskModule(res, org, "kiosk_punch"))) return;

    const isValid = await verifyKioskUser(org.id, utilisateur_id, pin);
    if (!isValid) return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));

    const result = await db.query(
      "UPDATE time_entries SET end_time = NOW() WHERE utilisateur_id = $1 AND end_time IS NULL AND deleted_at IS NULL RETURNING id, end_time",
      [utilisateur_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json(ApiResponse.error("NO_ACTIVE_TIMER", { message: "Aucune entree active" }));
    }

    return res.status(200).json(ApiResponse.success("PUNCHED_OUT", {
      timer: result.rows[0]
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

// 5. Punch KM (Save Mileage Expense)
router.post("/km", async (req, res) => {
  try {
    const { kiosk_token, utilisateur_id, pin, projet_id, distance, rate_per_unit, description, expense_date } = req.body;
    if (!kiosk_token || !utilisateur_id || !pin || !projet_id || distance === undefined) {
      return res.status(400).json(ApiResponse.error("BAD_REQUEST", { message: "Données manquantes" }));
    }

    const org = await getOrgByKioskToken(kiosk_token);
    if (!org) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Kiosque introuvable" }));
    if (!(await ensureKioskModule(res, org, "kiosk_km"))) return;

    const isValid = await verifyKioskUser(org.id, utilisateur_id, pin);
    if (!isValid) return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));

    const amount = parseFloat((distance * parseFloat(rate_per_unit || 0)).toFixed(2));

    const result = await db.query(
      `INSERT INTO expenses 
      (organisation_id, projet_id, category, amount, total_amount, distance, rate_per_unit, description, expense_date) 
      VALUES ($1, $2, 'mileage', $3, $3, $4, $5, $6, $7) RETURNING id`,
      [org.id, projet_id, amount, distance, rate_per_unit || 0, description, expense_date || new Date().toISOString().split("T")[0]]
    );

    return res.status(200).json(ApiResponse.success("KM_SAVED", {
      expense: result.rows[0]
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

module.exports = router;