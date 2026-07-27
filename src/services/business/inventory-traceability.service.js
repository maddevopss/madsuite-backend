function classifyLotStatus({ expiresAt, quarantined = false, recalled = false, remainingQuantity = 0 }, now = new Date()) {
  if (recalled) return 'recalled';
  if (quarantined) return 'quarantined';
  if (Number(remainingQuantity) <= 0) return 'consumed';
  if (expiresAt && new Date(expiresAt).getTime() < now.getTime()) return 'expired';
  return 'active';
}

function buildTraceSummary(events = []) {
  return events.reduce((summary, event) => {
    summary.totalEvents += 1;
    summary.byType[event.eventType] = (summary.byType[event.eventType] || 0) + 1;
    if (!summary.firstOccurredAt || event.occurredAt < summary.firstOccurredAt) summary.firstOccurredAt = event.occurredAt;
    if (!summary.lastOccurredAt || event.occurredAt > summary.lastOccurredAt) summary.lastOccurredAt = event.occurredAt;
    return summary;
  }, { totalEvents: 0, byType: {}, firstOccurredAt: null, lastOccurredAt: null });
}

module.exports = { classifyLotStatus, buildTraceSummary };
