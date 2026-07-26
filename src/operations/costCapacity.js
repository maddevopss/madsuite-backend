function recordUsage(input = {}) {
  if (!input.serviceId || !input.period || !input.metric || input.quantity == null) throw new Error('capacity.required_fields');
  if (Number(input.quantity) < 0) throw new Error('capacity.quantity_invalid');
  return { contract:'cost-capacity@1', serviceId:input.serviceId, period:input.period, metric:input.metric, quantity:Number(input.quantity), unitCost:Number(input.unitCost || 0), source:input.source || 'operations', financialReference:input.financialReference || null };
}
function summarizeCapacity(records = [], threshold = {}) {
  const seen = new Set();
  let operationalCost = 0;
  const usage = {};
  for (const record of records) {
    const key = `${record.serviceId}:${record.period}:${record.metric}:${record.financialReference || record.source}`;
    if (seen.has(key)) throw new Error('capacity.duplicate_record');
    seen.add(key);
    usage[record.metric] = (usage[record.metric] || 0) + record.quantity;
    if (!record.financialReference) operationalCost += record.quantity * record.unitCost;
  }
  const alerts = Object.entries(threshold).filter(([metric, limit]) => (usage[metric] || 0) >= limit).map(([metric, limit]) => ({ metric, limit, actual:usage[metric] || 0 }));
  return { contract:'cost-capacity-summary@1', usage, operationalCost:Number(operationalCost.toFixed(2)), alerts };
}
module.exports = { recordUsage, summarizeCapacity };
