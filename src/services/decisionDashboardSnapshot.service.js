const crypto = require('crypto');
function hashSnapshot(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
function lockSnapshot(snapshot = {}) {
  if (!snapshot.sourceHash) throw new Error('sourceHash requis');
  return { ...snapshot, lockedAt: new Date().toISOString(), immutable: true };
}
module.exports = { hashSnapshot, lockSnapshot };
