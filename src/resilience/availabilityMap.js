'use strict';

const SERVICE_CLASSES = Object.freeze(['essential', 'degraded', 'non_essential']);

function defineAvailabilityTarget(input) {
  const required = ['component', 'owner', 'serviceClass', 'targetPercent', 'measurementWindowDays'];
  for (const field of required) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      throw new Error(`availability_target_${field}_required`);
    }
  }
  if (!SERVICE_CLASSES.includes(input.serviceClass)) throw new Error('availability_target_invalid_service_class');
  if (input.targetPercent <= 0 || input.targetPercent > 100) throw new Error('availability_target_invalid_percent');
  const allowedDowntimeMinutes = Math.round(input.measurementWindowDays * 24 * 60 * (1 - input.targetPercent / 100));
  return Object.freeze({ ...input, allowedDowntimeMinutes, version: 1 });
}

function findSinglePointsOfFailure(components) {
  return components.filter((component) => component.critical && (!component.redundancy || component.redundancy < 2));
}

module.exports = { SERVICE_CLASSES, defineAvailabilityTarget, findSinglePointsOfFailure };
