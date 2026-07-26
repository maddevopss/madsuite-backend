const journeys = [
  ['risk', 'treatment', 'review'],
  ['incident', 'continuity', 'decision', 'lesson'],
  ['audit', 'corrective_action', 'verification'],
  ['budget', 'approval', 'tracking'],
  ['document', 'version', 'publication', 'retention'],
];

function validateJourney(steps) {
  return steps.length >= 3 && new Set(steps).size === steps.length;
}

describe('stage7 priority journeys', () => {
  test.each(journeys)('defines a complete deterministic journey', (...steps) => {
    expect(validateJourney(steps)).toBe(true);
  });

  test('keeps every terminal step explicit', () => {
    expect(journeys.map(steps => steps.at(-1))).toEqual(['review', 'lesson', 'verification', 'tracking', 'retention']);
  });
});

module.exports = { journeys, validateJourney };
