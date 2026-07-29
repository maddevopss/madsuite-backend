'use strict';

const express = require('express');
const crypto = require('crypto');
const { validateGovernanceCommand, createGovernanceResponse } = require('../modules/governance/api/governanceApi.contract');

function createGovernanceRouter({ orchestrator, repository, integrityService, requireOrganisation, requireAuth }) {
  if (!orchestrator || !repository || !integrityService) throw new TypeError('governance_dependencies_required');
  const router = express.Router();

  if (requireAuth) router.use(requireAuth);
  if (requireOrganisation) router.use(requireOrganisation);

  router.post('/cases/:caseId/transitions', async (req, res, next) => {
    try {
      const organisationId = req.organisation?.id || req.user?.organisation_id;
      const command = {
        ...req.body,
        organisationId,
        aggregateId: req.params.caseId,
        actorId: req.user?.id,
      };
      const validation = validateGovernanceCommand(command);
      if (!validation.valid) return res.status(400).json({ code: 'GOVERNANCE_COMMAND_INVALID', errors: validation.errors });

      const decision = orchestrator.evaluateGovernanceCommand({
        command,
        resourceOrganisationId: organisationId,
        ...req.body.context,
      });

      const event = {
        id: crypto.randomUUID(),
        type: `governance.${command.action}`,
        payload: { targetState: decision.targetState },
      };
      const integrity = integrityService.signGovernanceRecord(event, process.env.GOVERNANCE_SIGNING_SECRET);
      const persisted = await repository.appendTransition({
        command: { ...command, id: crypto.randomUUID(), caseId: req.params.caseId },
        targetState: decision.targetState,
        event,
        integrity,
      });

      return res.status(201).json(createGovernanceResponse({ commandId: persisted.commandId, state: persisted.state, links: { eventId: persisted.eventId } }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createGovernanceRouter };
