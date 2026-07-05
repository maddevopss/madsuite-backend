const {
  MODULES,
  isModuleIncludedInPlan,
  getModuleRegistryDiagnostics,
} = require("../config/modules");

function normalizeEnabledMap(rows = []) {
  return rows.reduce((map, row) => {
    if (row?.module_key) {
      map[row.module_key] = row.is_active === true;
    }
    return map;
  }, {});
}

function normalizePricingMap(rows = []) {
  return rows.reduce((map, row) => {
    if (row?.module_key) {
      map[row.module_key] = {
        price_cents: row.price_cents,
        currency: row.currency || "CAD",
      };
    }
    return map;
  }, {});
}

function buildModuleDto({ key, config, planType = "free", enabledMap = {}, pricingMap = {} }) {
  const includedInPlan = isModuleIncludedInPlan(key, planType);
  const explicitlyEnabled = enabledMap[key] === true;
  const isActive = includedInPlan || explicitlyEnabled;
  const dynamic = pricingMap[key];
  const price = dynamic ? Number(dynamic.price_cents || 0) / 100 : config.price;

  return {
    key,
    label: config.label,
    plan: config.plan,
    price,
    currency: dynamic?.currency || "CAD",
    matrix_status: config.matrix_status,
    is_active: isActive,
    active: isActive,
    included_in_plan: includedInPlan,
    included: includedInPlan,
    is_addon_active: !includedInPlan && explicitlyEnabled,
  };
}

function buildModulesPayload({ planType = "free", enabledMap = {}, pricingMap = {} } = {}) {
  const modules = Object.entries(MODULES).map(([key, config]) => buildModuleDto({
    key,
    config,
    planType,
    enabledMap,
    pricingMap,
  }));

  return {
    plan_type: planType || "free",
    modules,
    diagnostics: getModuleRegistryDiagnostics(),
  };
}

module.exports = {
  normalizeEnabledMap,
  normalizePricingMap,
  buildModuleDto,
  buildModulesPayload,
};
