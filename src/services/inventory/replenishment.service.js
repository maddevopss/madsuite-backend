'use strict';

function suggestReorder({ available = 0, reorderPoint = 0, targetLevel = 0, onOrder = 0 } = {}) {
  const projected = Number(available) + Number(onOrder);
  const needed = projected <= Number(reorderPoint) ? Math.max(0, Number(targetLevel) - projected) : 0;
  return { projected, reorder: needed > 0, suggestedQuantity: needed };
}

module.exports = { suggestReorder };
