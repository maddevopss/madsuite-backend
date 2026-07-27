function buildPaymentForecast({ bills = [], availableCash = null }) {
  const normalized = bills.map((bill) => ({ ...bill, amount: Number(bill.amount || 0), overdue: Boolean(bill.overdue), discount: Number(bill.discount || 0), critical: Boolean(bill.critical) }));
  const dueTotal = normalized.reduce((sum, bill) => sum + bill.amount, 0);
  const overdueTotal = normalized.filter((bill) => bill.overdue).reduce((sum, bill) => sum + bill.amount, 0);
  const discountOpportunity = normalized.reduce((sum, bill) => sum + bill.discount, 0);
  const prioritized = [...normalized].sort((a,b) => Number(b.critical)-Number(a.critical) || Number(b.overdue)-Number(a.overdue) || b.discount-a.discount);
  let remaining = availableCash == null ? Infinity : Number(availableCash);
  const recommendations = prioritized.map((bill) => { const pay = Math.min(bill.amount, remaining); remaining -= pay; return { id: bill.id, recommendedAmount: Number(pay.toFixed(2)) }; }).filter((item) => item.recommendedAmount > 0);
  const recommendedPaymentTotal = recommendations.reduce((sum,item)=>sum+item.recommendedAmount,0);
  return { dueTotal:Number(dueTotal.toFixed(2)), overdueTotal:Number(overdueTotal.toFixed(2)), discountOpportunity:Number(discountOpportunity.toFixed(2)), recommendedPaymentTotal:Number(recommendedPaymentTotal.toFixed(2)), recommendations };
}
module.exports = { buildPaymentForecast };