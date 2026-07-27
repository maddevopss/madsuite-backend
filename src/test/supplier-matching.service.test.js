const { evaluateLine } = require('../services/business/supplier-matching.service');

describe('supplier matching', () => {
  const policy = { matching_mode: 'three_way', price_tolerance_percent: 2, quantity_tolerance_percent: 0 };

  test('accepte une ligne conforme à la commande et à la réception', () => {
    expect(evaluateLine({ billLine: { unit_price: 10, quantity: 5 }, orderLine: { unit_price: 10, quantity: 5 }, receiptLine: { quantity_received: 5 }, policy })).toEqual([]);
  });

  test('détecte les écarts de prix et de quantité', () => {
    const result = evaluateLine({ billLine: { unit_price: 12, quantity: 6 }, orderLine: { unit_price: 10, quantity: 6 }, receiptLine: { quantity_received: 5 }, policy });
    expect(result.map((item) => item.exceptionType)).toEqual(expect.arrayContaining(['price', 'quantity']));
  });

  test('exige une réception en rapprochement à trois pièces', () => {
    const result = evaluateLine({ billLine: { unit_price: 10, quantity: 5 }, orderLine: { unit_price: 10, quantity: 5 }, receiptLine: null, policy });
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ exceptionType: 'missing_receipt' })]));
  });
});
