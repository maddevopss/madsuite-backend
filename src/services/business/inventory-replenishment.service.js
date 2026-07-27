function calculateSuggestedQuantity(input) {
  const onHand = Number(input.quantityOnHand || 0);
  const reserved = Number(input.quantityReserved || 0);
  const onOrder = Number(input.quantityOnOrder || 0);
  const reorderPoint = Number(input.reorderPoint || 0);
  const safetyStock = Number(input.safetyStock || 0);
  const reorderQuantity = Number(input.reorderQuantity || 0);
  const available = onHand - reserved + onOrder;
  if (available > reorderPoint) return 0;
  const target = reorderPoint + safetyStock + reorderQuantity;
  return Number(Math.max(target - available, reorderQuantity, 0).toFixed(3));
}

function buildSuggestion(input) {
  const suggestedQuantity = calculateSuggestedQuantity(input);
  return {
    ...input,
    availableQuantity: Number((Number(input.quantityOnHand || 0) - Number(input.quantityReserved || 0) + Number(input.quantityOnOrder || 0)).toFixed(3)),
    suggestedQuantity,
    shouldReorder: suggestedQuantity > 0,
  };
}

module.exports = { calculateSuggestedQuantity, buildSuggestion };
