const fs = require("fs");
const path = require("path");
const { DEFAULT_RULES } = require("./activityIntelligence.defaults");
const { getCustomRules } = require("./activity-intelligence-crud.service");

// Load rules dynamically
const rulesDir = path.join(__dirname, "activity-intelligence", "rules");
const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith(".rule.js"));

const baseRules = [];
const modifierRules = [];
const contextRules = [];

for (const file of ruleFiles) {
  const rule = require(path.join(rulesDir, file));
  if (rule.type === "modifier") {
    modifierRules.push(rule);
  } else if (file === "devContext.rule.js" || file === "meetingAdmin.rule.js") {
    contextRules.push(rule);
  } else {
    baseRules.push(rule);
  }
}

// Order: customDB, heuristic, fallback
const baseClassificationPipeline = [];
const customRule = baseRules.find(r => r.evaluate.toString().includes("custom-rule"));
if (customRule) baseClassificationPipeline.push(customRule);
const heuRule = baseRules.find(r => r === require("./activity-intelligence/rules/heuristic.rule"));
if (heuRule) baseClassificationPipeline.push(heuRule);
const fbRule = baseRules.find(r => r === require("./activity-intelligence/rules/fallback.rule"));

const multiAppContextPipeline = contextRules;

function applyModifiers(classification, context) {
  let modifiedClassification = { ...classification };
  for (const rule of modifierRules) {
    modifiedClassification = rule.evaluate(context, modifiedClassification);
  }
  return modifiedClassification;
}

async function classifyActivity(organisationId, activityOrAppName, windowTitle = "") {
  let appName = activityOrAppName;
  let activity = null;

  if (typeof activityOrAppName === 'object') {
    activity = activityOrAppName;
    appName = activity.app_name;
    windowTitle = activity.window_title;
  }

  const customRules = await getCustomRules(organisationId);
  const dbRules = [...customRules, ...DEFAULT_RULES];
  
  const context = { activity, appName, windowTitle, dbRules };
  
  let classification = null;
  for (const rule of baseClassificationPipeline) {
    const result = rule.evaluate(context);
    if (result) {
      classification = result;
      break;
    }
  }
  
  if (!classification && fbRule) {
    classification = fbRule.evaluate(context);
  }

  return applyModifiers(classification, context);
}

async function classifyActivities(organisationId, activities = []) {
  const customRules = await getCustomRules(organisationId);
  const dbRules = [...customRules, ...DEFAULT_RULES];
  
  return activities.map((activity) => {
    const context = { activity, appName: activity.app_name, windowTitle: activity.window_title, dbRules };
    
    let classification = null;
    for (const rule of baseClassificationPipeline) {
      const result = rule.evaluate(context);
      if (result) {
        classification = result;
        break;
      }
    }
    
    if (!classification && fbRule) {
      classification = fbRule.evaluate(context);
    }
    
    return applyModifiers(classification, context);
  });
}

async function classifyCurrentContext({ organisationId, currentActivity, openWindows }) {
  let classification = await classifyActivity(organisationId, currentActivity);
  
  const context = { currentClassification: classification, openWindows, activity: currentActivity };
  
  for (const rule of multiAppContextPipeline) {
    const result = rule.evaluate(context);
    if (result) {
      classification = result; // override with enhanced context classification
      break;
    }
  }
  
  if (!context.openWindows || context.openWindows.length === 0 || !classification.context) {
    classification.context = "Contexte simple";
  }
  
  return classification;
}

module.exports = {
  classifyActivity,
  classifyActivities,
  classifyCurrentContext,
};
