const fallbackRule = {
  evaluate: (context) => {
    return { category: "Autre", tag: "other", confidence: 30, is_productive: true, source: "fallback" };
  }
};

module.exports = fallbackRule;
