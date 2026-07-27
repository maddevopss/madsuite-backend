function summarizeCommitment({ committedAmount, consumedAmount = 0, releasedAmount = 0 }) {
  const committed = Number(committedAmount || 0);
  const consumed = Number(consumedAmount || 0);
  const released = Number(releasedAmount || 0);
  const remaining = Number(Math.max(committed - consumed - released, 0).toFixed(2));
  const status = remaining === 0 ? (consumed >= committed ? 'consumed' : 'released') : consumed > 0 ? 'partially_consumed' : 'reserved';
  return { committed, consumed, released, remaining, status };
}
module.exports = { summarizeCommitment };