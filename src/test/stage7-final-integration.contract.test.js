const requiredBlocks = ['7A', '7B', '7C', '7D', '7E', '7F', '7G', '7H'];

function decideGoLive({ blocks = {}, residualRisksAccepted = false, stagingPassed = false, rollbackTested = false } = {}) {
  const complete = requiredBlocks.every(block => blocks[block] === true);
  return {
    contract: 'go-live-decision@1',
    complete,
    approved: complete && residualRisksAccepted && stagingPassed && rollbackTested,
  };
}

describe('stage7 final integration decision', () => {
  test('approves only from complete and explicit evidence', () => {
    const blocks = Object.fromEntries(requiredBlocks.map(block => [block, true]));
    expect(decideGoLive({ blocks, residualRisksAccepted: true, stagingPassed: true, rollbackTested: true }).approved).toBe(true);
  });

  test('refuses an implicit risk acceptance', () => {
    const blocks = Object.fromEntries(requiredBlocks.map(block => [block, true]));
    expect(decideGoLive({ blocks, stagingPassed: true, rollbackTested: true }).approved).toBe(false);
  });
});

module.exports = { requiredBlocks, decideGoLive };
