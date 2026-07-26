function settleConcurrent(commands) {
  const seen = new Set();
  return commands.map(command => {
    if (!command.idempotencyKey) return { status: 'rejected', code: 'idempotency.required' };
    if (seen.has(command.idempotencyKey)) return { status: 'replayed', code: 'idempotency.replayed' };
    seen.add(command.idempotencyKey);
    return { status: 'applied', code: null };
  });
}

describe('stage7 concurrency and idempotency', () => {
  test.each(['approval', 'payment', 'transition', 'network-retry'])('applies %s once', type => {
    const results = settleConcurrent([{ type, idempotencyKey: `${type}-1` }, { type, idempotencyKey: `${type}-1` }]);
    expect(results.map(item => item.status)).toEqual(['applied', 'replayed']);
  });
});

module.exports = { settleConcurrent };
