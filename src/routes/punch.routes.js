const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../../db");
const ApiResponse = require("../utils/apiResponse");
const { z } = require("zod");
const { requireModuleForOrg } = require("../middleware/requireModule");

// Validator for kiosk token
const kioskTokenSchema = z.string().min(10);

// organisations n'est pas sous RLS : la résolution du kiosque par jeton est
// intentionnellement cross-tenant (aucune session/organisation connue avant
// ce lookup) et fonctionne sans contexte particulier.
async function getOrgByKioskToken(kioskToken) {
  const result = await db.query(
    "SELECT id, nom FROM organisations WHERE kiosk_token = $1",
    [kioskToken]
  );
  return result.rows[0];
}

// utilisateurs/time_entries/projets/expenses sont sous RLS FORCE : ce
// terminal kiosque n'a aucune session utilisateur (identification par
// kiosk_token + NIP), donc aucun contexte ALS n'est jamais établi par un
// middleware. Chaque opération doit ouvrir sa propre connexion scopée.
async function withOrgScope(organisationId, fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function verifyKioskUser(client, organisationId, utilisateurId, pin) {
  const result = await client.query(
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

  res.status(403).json(ApiResponse.error("MODULE_NOT_AVAILABLE", {
    message: `Le module "${moduleKey}" n'est pas disponible pour cette organisation.`,
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
      return res.status(403).json(ApiResponse.error("MODULE_NOT_AVAILABLE", {
        message: "Aucun module kiosque n'est disponible pour votre organisation.",
      }));
    }

    const { employes, projets } = await withOrgScope(org.id, async (client) => {
      const usersRes = await client.query(
        "SELECT id, nom FROM utilisateurs WHERE organisation_id = $1 AND is_kiosk_user = true AND deleted_at IS NULL ORDER BY nom ASC",
        [org.id]
      );

      const projetsRes = await client.query(
        "SELECT id, nom FROM projets WHERE organisation_id = $1 AND status = 'actif' AND deleted_at IS NULL ORDER BY nom ASC",
        [org.id]
      );

      return { employes: usersRes.rows, projets: projetsRes.rows };
    });

    return res.status(200).json(ApiResponse.success("KIOSK_INFO", {
      organisation: { id: org.id, nom: org.nom },
      employes,
      projets
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

    const activeTimer = await withOrgScope(org.id, async (client) => {
      const isValid = await verifyKioskUser(client, org.id, utilisateur_id, pin);
      if (!isValid) return { unauthorized: true };

      const result = await client.query(
        "SELECT id, start_time, projet_id FROM time_entries WHERE utilisateur_id = $1 AND organisation_id = $2 AND end_time IS NULL AND deleted_at IS NULL",
        [utilisateur_id, org.id]
      );
      return { unauthorized: false, timer: result.rows[0] || null };
    });

    if (activeTimer.unauthorized) {
      return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));
    }

    return res.status(200).json(ApiResponse.success("STATUS", {
      active_timer: activeTimer.timer
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

    const outcome = await withOrgScope(org.id, async (client) => {
      const isValid = await verifyKioskUser(client, org.id, utilisateur_id, pin);
      if (!isValid) return { unauthorized: true };

      // Stop any active timer first
      await client.query(
        "UPDATE time_entries SET end_time = NOW() WHERE utilisateur_id = $1 AND organisation_id = $2 AND end_time IS NULL AND deleted_at IS NULL",
        [utilisateur_id, org.id]
      );

      // Create new timer
      const newTimer = await client.query(
        "INSERT INTO time_entries (utilisateur_id, projet_id, organisation_id, start_time) VALUES ($1, $2, $3, NOW()) RETURNING id, start_time",
        [utilisateur_id, projet_id, org.id]
      );

      return { unauthorized: false, timer: newTimer.rows[0] };
    });

    if (outcome.unauthorized) {
      return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));
    }

    return res.status(200).json(ApiResponse.success("PUNCHED_IN", {
      timer: outcome.timer
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

    const outcome = await withOrgScope(org.id, async (client) => {
      const isValid = await verifyKioskUser(client, org.id, utilisateur_id, pin);
      if (!isValid) return { unauthorized: true };

      const result = await client.query(
        "UPDATE time_entries SET end_time = NOW() WHERE utilisateur_id = $1 AND organisation_id = $2 AND end_time IS NULL AND deleted_at IS NULL RETURNING id, end_time",
        [utilisateur_id, org.id]
      );

      return { unauthorized: false, timer: result.rows[0] || null };
    });

    if (outcome.unauthorized) {
      return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));
    }

    if (!outcome.timer) {
      return res.status(400).json(ApiResponse.error("NO_ACTIVE_TIMER", { message: "Aucune entree active" }));
    }

    return res.status(200).json(ApiResponse.success("PUNCHED_OUT", {
      timer: outcome.timer
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

    const amount = parseFloat((distance * parseFloat(rate_per_unit || 0)).toFixed(2));

    const outcome = await withOrgScope(org.id, async (client) => {
      const isValid = await verifyKioskUser(client, org.id, utilisateur_id, pin);
      if (!isValid) return { unauthorized: true };

      const result = await client.query(
        `INSERT INTO expenses
        (organisation_id, projet_id, category, amount, total_amount, distance, rate_per_unit, description, expense_date)
        VALUES ($1, $2, 'mileage', $3, $3, $4, $5, $6, $7) RETURNING id`,
        [org.id, projet_id, amount, distance, rate_per_unit || 0, description, expense_date || new Date().toISOString().split("T")[0]]
      );

      return { unauthorized: false, expense: result.rows[0] };
    });

    if (outcome.unauthorized) {
      return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "NIP invalide" }));
    }

    return res.status(200).json(ApiResponse.success("KM_SAVED", {
      expense: outcome.expense
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

module.exports = router;
