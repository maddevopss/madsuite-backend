function deliveryKey(event = {}) {
  const aggregate = String(event.aggregateId || '').trim();
  const type = String(event.type || '').trim();
  const version = Number(event.version || 1);
  if (!aggregate || !type || !Number.isInteger(version) || version < 1) throw new Error('outbox.event.invalid');
  return `${type}:${aggregate}:v${version}`;
}

function prepareDelivery(event, now = new Date()) {
  return Object.freeze({
    contract: 'outbox-delivery@1',
    key: deliveryKey(event),
    status: 'pending',
    attempts: 0,
    createdAt: now.toISOString(),
    deliveredAt: null,
  });
}

function markDelivered(delivery, now = new Date()) {
  if (!delivery || delivery.contract !== 'outbox-delivery@1') throw new Error('outbox.delivery.invalid');
  return { ...delivery, status: 'delivered', attempts: delivery.attempts + 1, deliveredAt: now.toISOString(), lastError: null };
}

function markFailed(delivery, error) {
  if (!delivery || !error) throw new Error('outbox.failure.invalid');
  return { ...delivery, status: 'pending', attempts: delivery.attempts + 1, lastError: String(error.code || error.message || 'delivery.failed') };
}

function reconcileDeliveries(deliveries = []) {
  const byKey = new Map();
  for (const delivery of deliveries) {
    const current = byKey.get(delivery.key);
    if (!current || delivery.attempts > current.attempts || delivery.deliveredAt) byKey.set(delivery.key, delivery);
  }
  return { contract: 'outbox-reconciliation@1', deliveries: [...byKey.values()], pending: [...byKey.values()].filter((item) => item.status !== 'delivered').length };
}

module.exports = { deliveryKey, prepareDelivery, markDelivered, markFailed, reconcileDeliveries };
