const crypto = require('crypto');
function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function buildYearEndSlip({ slipType, earnings = 0, tax = 0, pension = 0, insurance = 0, other = {} }) {
  if (!['T4','RL1','T4A','RL2'].includes(slipType)) throw Object.assign(new Error('Le type de feuillet fiscal est invalide.'), { statusCode: 400 });
  const boxes = { earnings: money(earnings), tax: money(tax), pension: money(pension), insurance: money(insurance), ...other };
  if (Object.values(boxes).some((value) => typeof value === 'number' && value < 0)) throw Object.assign(new Error('Les montants du feuillet ne peuvent pas être négatifs.'), { statusCode: 400 });
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify({ slipType, boxes })).digest('hex');
  return { slipType, boxes, sourceHash };
}
module.exports = { buildYearEndSlip };
