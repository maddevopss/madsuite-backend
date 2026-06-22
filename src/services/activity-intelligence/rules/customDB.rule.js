const { normalize } = require("../../activity-intelligence-utils");

function ruleMatches(rule, appName = "", windowTitle = "") {
  const app = normalize(appName);
  const title = normalize(windowTitle);
  const appPattern = normalize(rule.app_pattern);
  const titlePattern = normalize(rule.title_pattern);

  if (!appPattern || !app.includes(appPattern)) return false;
  if (titlePattern && !title.includes(titlePattern)) return false;

  return true;
}

const customDBRule = {
  evaluate: (context) => {
    const { appName, windowTitle, dbRules } = context;
    if (!dbRules) return null;

    const match = dbRules.find((rule) => ruleMatches(rule, appName, windowTitle));

    if (match) {
      return {
        category: match.category,
        tag: match.tag || null,
        confidence: Number(match.confidence ?? 70),
        is_productive: match.is_productive !== false,
        source: match.id ? "custom-rule" : "default-rule",
        rule_id: match.id || null,
      };
    }
    return null;
  }
};

module.exports = customDBRule;
