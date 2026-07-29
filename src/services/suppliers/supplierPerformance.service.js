'use strict';

function calculateSupplierScore({ orders = 0, onTimeDeliveries = 0, acceptedReceipts = 0, totalReceipts = 0, priceVariancePercent = 0 }) {
  const deliveryScore = orders ? (onTimeDeliveries / orders) * 100 : 100;
  const qualityScore = totalReceipts ? (acceptedReceipts / totalReceipts) * 100 : 100;
  const priceScore = Math.max(0, 100 - Math.abs(Number(priceVariancePercent)) * 5);
  const score = Math.round(deliveryScore * 0.4 + qualityScore * 0.4 + priceScore * 0.2);
  return { score, deliveryScore: Math.round(deliveryScore), qualityScore: Math.round(qualityScore), priceScore: Math.round(priceScore), status: score >= 85 ? 'excellent' : score >= 70 ? 'acceptable' : 'attention' };
}

module.exports = { calculateSupplierScore };