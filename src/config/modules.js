/**
 * Définition centrale de tous les modules MADSuite.
 *
 * plan:
 * - "free" = toujours actif
 * - "trial" = disponible en essai contrôlé
 * - "pro" = inclus dans le plan pro ou supérieur
 * - "addon" = payant séparément / activation explicite
 * - "internal" = usage admin/interne seulement tant que non cadré produit
 *
 * price: prix mensuel en CAD (0 si inclus dans un plan)
 */
const MODULES = {
  // --- Modules core / gratuits ---
  dashboard:     { label: "Dashboard",         plan: "free",  price: 0, matrix_status: "legacy_ui" },
  clients:       { label: "Clients",           plan: "free",  price: 0, matrix_status: "core" },
  projects:      { label: "Projets",           plan: "free",  price: 0, matrix_status: "core" },
  timesheet:     { label: "Feuilles de temps", plan: "free",  price: 0, matrix_status: "legacy_key" },
  time_tracking: { label: "Suivi du temps",    plan: "free",  price: 0, matrix_status: "core" },

  // --- Modules inclus dans Pro ---
  invoices:      { label: "Factures",          plan: "pro",   price: 0, matrix_status: "core" },
  reports:       { label: "Rapports",          plan: "pro",   price: 0, matrix_status: "business" },
  kiosk_punch:   { label: "Kiosque Punch",     plan: "pro",   price: 0, matrix_status: "operational" },

  // --- Add-ons payants ---
  calcul_km:     { label: "Calcul KM / GPS",          plan: "addon", price: 5,  matrix_status: "operational" },
  kiosk_km:      { label: "Kiosque Kilométrage",       plan: "addon", price: 5,  matrix_status: "operational" },
  estimates:     { label: "Soumissions",               plan: "addon", price: 5,  matrix_status: "business" },
  quotes:        { label: "Devis",                     plan: "addon", price: 5,  matrix_status: "business" },
  expenses:      { label: "Dépenses",                  plan: "addon", price: 5,  matrix_status: "business" },
  payments:      { label: "Paiements",                 plan: "addon", price: 0,  matrix_status: "business" },
  activity_intelligence: { label: "Activity Intelligence", plan: "addon", price: 10, matrix_status: "non_medical_assistance" },
  billing_assistant:     { label: "Billing Assistant",     plan: "addon", price: 10, matrix_status: "non_medical_assistance" },

  // --- Modules internes / MADPROOF strict ---
  cognitive_engine: { label: "Moteur cognitif", plan: "internal", price: 0, matrix_status: "madproof_strict" },
  desktop_agent:    { label: "Agent desktop",   plan: "internal", price: 0, matrix_status: "consent_required" },
};

const INTERNAL_PLAN_TYPES = new Set(["admin", "internal", "master_admin", "platform_admin"]);
const ADDON_ELIGIBLE_PLANS = new Set(["enterprise", "admin", "internal", "master_admin", "platform_admin"]);

// Les modules "free" sont toujours autorisés
const FREE_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "free");
const PRO_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "pro");
const ADDON_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "addon");
const INTERNAL_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "internal");

/**
 * Vérifie si un module est autorisé pour un plan donné.
 * @param {string} moduleKey - Ex: "invoices"
 * @param {string} planType - "free", "trial", "solo", "pro", "enterprise", "admin", "internal"
 * @returns {boolean}
 */
function isModuleIncludedInPlan(moduleKey, planType) {
  const mod = MODULES[moduleKey];
  if (!mod) return false;

  const normalizedPlan = String(planType || "free").toLowerCase();

  if (mod.plan === "free") return true;
  if (mod.plan === "trial" && ["trial", "solo", "pro", "enterprise"].includes(normalizedPlan)) return true;
  if (mod.plan === "pro" && ["pro", "enterprise", "admin", "internal", "master_admin", "platform_admin"].includes(normalizedPlan)) return true;
  if (mod.plan === "addon" && ADDON_ELIGIBLE_PLANS.has(normalizedPlan)) return true;
  if (mod.plan === "internal" && INTERNAL_PLAN_TYPES.has(normalizedPlan)) return true;

  // Les add-ons ne sont jamais inclus dans un plan — ils doivent être activés explicitement
  return false;
}

function getModuleRegistryDiagnostics() {
  const keys = Object.keys(MODULES);
  const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
  const modulesWithoutMatrixStatus = keys.filter((key) => !MODULES[key].matrix_status);

  return {
    moduleCount: keys.length,
    duplicateKeys,
    modulesWithoutMatrixStatus,
    internalModules: INTERNAL_MODULES,
  };
}

module.exports = {
  MODULES,
  FREE_MODULES,
  PRO_MODULES,
  ADDON_MODULES,
  INTERNAL_MODULES,
  INTERNAL_PLAN_TYPES,
  isModuleIncludedInPlan,
  getModuleRegistryDiagnostics,
};
