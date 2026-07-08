// Filtrage local des activités pour les tests backend.
// Ce module reflète le contrat privacy du desktop-agent sans dépendre d'un repo frère en CI.

function normalizeString(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const IGNORED_APPS = [
  "Electron",
  "MADSuite",
  "ApplicationFrameHost",
  "SystemSettings",
  "TextInputHost",
  "PowerToys.QuickAccess",
];

const IGNORED_TITLES = ["Paramètres", "Settings", "Developer Tools"];

const PRIVACY_PATTERNS = [
  /mot\s*de\s*passe/i,
  /password/i,
  /secret/i,
  /credential/i,
  /confidentiel/i,
  /private/i,
  /credit\s*card/i,
  /carte\s*bancaire/i,
  /nas/i,
  /sin/i,
  /assurance\s*sociale/i,
  /numéro\s*d'?assurance/i,
  /social\s*security/i,
  /ssn/i,
  /bearer\b/i,
  /authorization\b/i,
  /auth\s*header/i,
  /confidential/i,
];

function isPrivacySensitiveTitle(window_title) {
  return PRIVACY_PATTERNS.some((pattern) => pattern.test(window_title || ""));
}

function includesCustomPattern(value, patterns = []) {
  const normalizedValue = normalizeString(value);
  return patterns.some((pattern) => normalizedValue.includes(normalizeString(String(pattern || "").trim())));
}

function shouldIgnoreActivity({ app_name, window_title }, options = {}) {
  if (!app_name && !window_title) return true;

  if (includesCustomPattern(app_name, options.ignoredApps)) return true;
  if (includesCustomPattern(window_title, options.ignoredKeywords)) return true;

  if (
    IGNORED_APPS.some((app) =>
      String(app_name || "")
        .toLowerCase()
        .includes(app.toLowerCase()),
    )
  ) {
    return true;
  }

  if (IGNORED_TITLES.some((title) => normalizeString(window_title).includes(normalizeString(title)))) {
    return true;
  }

  if (isPrivacySensitiveTitle(window_title)) {
    return true;
  }

  if (!String(window_title || "").trim()) return true;

  return false;
}

function getActivitySignature({ app_name, window_title }) {
  return `${app_name || ""}::${window_title || ""}`;
}

module.exports = {
  shouldIgnoreActivity,
  getActivitySignature,
  isPrivacySensitiveTitle,
  includesCustomPattern,
};
