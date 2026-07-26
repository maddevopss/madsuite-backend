function defineObjective(input = {}) {
  if (!input.serviceId || !input.period || input.targetAvailability == null) throw new Error('slo.required_fields');
  if (input.targetAvailability <= 0 || input.targetAvailability > 100) throw new Error('slo.availability_invalid');
  return { contract:'service-level-objective@1', serviceId:input.serviceId, period:input.period, targetAvailability:input.targetAvailability, targetResponseMs:input.targetResponseMs || null, targetRestoreMinutes:input.targetRestoreMinutes || null };
}
function calculateServiceLevel(objective, observation = {}) {
  const total = Number(observation.totalMinutes || 0);
  const downtime = Number(observation.downtimeMinutes || 0);
  if (total <= 0 || downtime < 0 || downtime > total) throw new Error('slo.observation_invalid');
  const availability = ((total - downtime) / total) * 100;
  const allowedDowntime = total * (1 - objective.targetAvailability / 100);
  const errorBudgetRemaining = allowedDowntime - downtime;
  return { contract:'service-level-result@1', serviceId:objective.serviceId, availability:Number(availability.toFixed(4)), targetMet:availability >= objective.targetAvailability, errorBudgetMinutes:Number(errorBudgetRemaining.toFixed(2)), incidentCount:Number(observation.incidentCount || 0), drifting:errorBudgetRemaining < Math.max(allowedDowntime * 0.25, 0) };
}
module.exports = { defineObjective, calculateServiceLevel };
