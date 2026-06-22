const { appendOrganisationScope, buildFeedbackKeyword, getOrganisationId } = require("./activity-intelligence-utils");
const { classifyActivity, classifyActivities, classifyCurrentContext } = require("./activity-intelligence-engine.service");
const { getCustomRules, listRules, createRule, getRuleById, updateRule, disableRule, saveActivityFeedback } = require("./activity-intelligence-crud.service");
const { missingActivityTables, getInsights, analyzeActivityLog } = require("./activity-intelligence-insights.service");

function detectMultiAppContext(currentClassification, openWindows = []) {
  // Legacy bridge just in case something calls this explicitly
  // though we have moved logic to rules engine
  const devRule = require("./rules/devContext.rule");
  const meetingRule = require("./rules/meetingAdmin.rule");
  
  const context = { currentClassification, openWindows };
  const res1 = devRule.evaluate(context);
  if (res1) return res1;
  const res2 = meetingRule.evaluate(context);
  if (res2) return res2;

  return {
    ...currentClassification,
    context: "Contexte simple",
  };
}

module.exports = {
  appendOrganisationScope,
  buildFeedbackKeyword,
  classifyActivity,
  classifyActivities,
  detectMultiAppContext,
  getOrganisationId,

  missingActivityTables,
  getInsights,
  analyzeActivityLog,
  classifyCurrentContext,
  listRules,
  createRule,
  updateRule,
  disableRule,
  saveActivityFeedback,
};
