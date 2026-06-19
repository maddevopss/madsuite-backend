/**
 * Définition centrale de tous les modules MADSuite.
 * 
 * plan: "free" = toujours actif, "pro" = inclus dans le plan pro, "addon" = payant séparément
 * price: prix mensuel en CAD (0 si inclus dans un plan)
 */
const MODULES = {
  // --- Modules gratuits (toujours actifs) ---
  dashboard:    { label: "Dashboard",         plan: "free",  price: 0 },
  timesheet:    { label: "Feuilles de temps", plan: "free",  price: 0 },
  clients:      { label: "Clients",           plan: "free",  price: 0 },
  projects:     { label: "Projets",           plan: "free",  price: 0 },

  // --- Modules inclus dans Pro (20$/mois) ---
  invoices:     { label: "Factures",          plan: "pro",   price: 0 },
  reports:      { label: "Rapports",          plan: "pro",   price: 0 },
  kiosk_punch:  { label: "Kiosque Punch",     plan: "pro",   price: 0 },

  // --- Add-ons payants ---
  calcul_km:    { label: "Calcul KM / GPS",            plan: "addon", price: 5 },
  kiosk_km:     { label: "Kiosque Kilométrage",         plan: "addon", price: 5 },
  estimates:    { label: "Soumissions",                  plan: "addon", price: 5 },
  activity_intelligence: { label: "Activity Intelligence", plan: "addon", price: 10 },
  billing_assistant:     { label: "Billing Assistant",     plan: "addon", price: 10 },
};

// Les modules "free" sont toujours autorisés
const FREE_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "free");
const PRO_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "pro");
const ADDON_MODULES = Object.keys(MODULES).filter(k => MODULES[k].plan === "addon");

/**
 * Vérifie si un module est autorisé pour un plan donné.
 * @param {string} moduleKey - Ex: "invoices"
 * @param {string} planType - "free", "pro", ou "enterprise"
 * @returns {boolean}
 */
function isModuleIncludedInPlan(moduleKey, planType) {
  const mod = MODULES[moduleKey];
  if (!mod) return false;

  if (mod.plan === "free") return true;
  if (mod.plan === "pro" && (planType === "pro" || planType === "enterprise")) return true;
  // Les add-ons ne sont jamais inclus dans un plan — ils doivent être activés explicitement
  return false;
}

module.exports = { MODULES, FREE_MODULES, PRO_MODULES, ADDON_MODULES, isModuleIncludedInPlan };
