const { normalize } = require("../../activity-intelligence-utils");

const heuristicRule = {
  evaluate: (context) => {
    const { appName, windowTitle } = context;
    const text = normalize(`${appName} ${windowTitle}`);

    if (text.includes("localhost") || text.includes("github") || text.includes("jira") || text.includes("linear")) {
      return { category: "Développement", tag: "dev", confidence: 70, is_productive: true, source: "heuristic" };
    }
    
    return null;
  }
};

module.exports = heuristicRule;
