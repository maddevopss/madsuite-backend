'use strict';

function buildResumePoint(session) {
  if (!session) return null;
  return {
    title: session.title || 'Reprendre le travail',
    entityType: session.entityType || null,
    entityId: session.entityId || null,
    lastAction: session.lastAction || null,
    nextSuggestedStep: session.nextSuggestedStep || null,
    savedAt: session.savedAt || new Date().toISOString(),
  };
}

module.exports = { buildResumePoint };
