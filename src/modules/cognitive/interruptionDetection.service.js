'use strict';

function detectInterruption(previous, current, thresholdSeconds = 120) {
  if (!previous || !current) return null;
  const gapSeconds = (new Date(current.at) - new Date(previous.at)) / 1000;
  const contextChanged = previous.contextKey !== current.contextKey;
  return gapSeconds >= thresholdSeconds || contextChanged
    ? { gapSeconds, contextChanged, detected: true }
    : { gapSeconds, contextChanged, detected: false };
}

module.exports = { detectInterruption };
