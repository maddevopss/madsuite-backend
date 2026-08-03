/**
 * Issue #172 PR F: Fermeture Étage 4 - Block Closure & Error Contract
 *
 * Validates:
 * 1. BlockClosureError thrown when attempting to modify resources in final states
 * 2. Error contract standardization: { code, message, details }
 * 3. HTTP 409 status for blocked closure attempts
 * 4. Integration with existing transition validators (PRs A-E)
 */

const { BlockClosureError, checkBlockClosure, DEFAULT_FINAL_STATES } = require('../utils/blockClosureValidation');
const { TransitionValidationError } = require('../utils/transitionSchema');

describe('PR F: Block Closure & Error Contract', () => {
  describe('blockClosureValidation utility', () => {
    it('should not throw for resource in non-final state', () => {
      const resource = { id: 1, status: 'active', resourceType: 'audit_finding' };
      expect(() => checkBlockClosure(resource)).not.toThrow();
    });

    it('should throw BlockClosureError for resource in final state', () => {
      const resource = { id: 1, status: 'closed', resourceType: 'audit_finding' };
      expect(() => checkBlockClosure(resource)).toThrow(BlockClosureError);
    });

    it('should include resourceId and currentStatus in error details', () => {
      const resource = { id: 42, status: 'archived', resourceType: 'governance_decision' };
      try {
        checkBlockClosure(resource);
        fail('should have thrown');
      } catch (err) {
        expect(err.details.resourceId).toBe(42);
        expect(err.details.currentStatus).toBe('archived');
        expect(err.details.finalStates).toContain('archived');
      }
    });

    it('should respect custom finalStates', () => {
      const resource = { id: 1, status: 'paused' };
      expect(() => checkBlockClosure(resource, { finalStates: ['paused'] })).toThrow();
    });

    it('should support custom statusField', () => {
      const resource = { id: 1, lifecycle_state: 'cancelled' };
      expect(() => checkBlockClosure(resource, { statusField: 'lifecycle_state' })).toThrow();
    });
  });

  describe('error contract standardization', () => {
    it('BlockClosureError should have code property', () => {
      const err = new BlockClosureError(1, 'finding', 'closed');
      expect(err.code).toBe('block_closure.resource_final');
    });

    it('BlockClosureError should have details object', () => {
      const err = new BlockClosureError(1, 'finding', 'closed');
      expect(typeof err.details).toBe('object');
      expect(err.details.reason).toBeDefined();
    });

    it('BlockClosureError should have statusCode 409', () => {
      const err = new BlockClosureError(1, 'finding', 'closed');
      expect(err.statusCode).toBe(409);
    });

    it('should format as business error contract', () => {
      const err = new BlockClosureError(42, 'audit_action', 'cancelled');
      const formatted = {
        code: err.code,
        message: err.message,
        details: err.details,
      };
      expect(formatted.code).toBe('block_closure.resource_final');
      expect(formatted.message).toBeDefined();
      expect(formatted.details.resourceId).toBe(42);
    });
  });

  describe('integration with TransitionValidationError', () => {
    it('both BlockClosureError and TransitionValidationError share error contract', () => {
      const blockErr = new BlockClosureError(1, 'finding', 'closed');
      const transErr = new TransitionValidationError('transition.evidence_required', { field: 'evidence' });

      expect(blockErr.code).toBeDefined();
      expect(blockErr.details).toBeDefined();
      expect(blockErr.statusCode).toBeDefined();

      expect(transErr.code).toBeDefined();
      expect(transErr.details).toBeDefined();
      expect(transErr.statusCode).toBeDefined();
    });

    it('errorHandler should recognize both error types', () => {
      // This would be tested in e2e tests or integration tests
      // Verifying the middleware properly formats both error types
      const blockErr = new BlockClosureError(1, 'finding', 'closed');
      const transErr = new TransitionValidationError('transition.evidence_required');

      expect(blockErr instanceof Error).toBe(true);
      expect(transErr instanceof Error).toBe(true);
    });
  });

  describe('final state constants', () => {
    it('DEFAULT_FINAL_STATES includes common final states', () => {
      expect(DEFAULT_FINAL_STATES).toContain('closed');
      expect(DEFAULT_FINAL_STATES).toContain('archived');
      expect(DEFAULT_FINAL_STATES).toContain('cancelled');
      expect(DEFAULT_FINAL_STATES).toContain('completed');
    });
  });

  describe('comprehensive scenario: blocked transitions', () => {
    it('should block modification attempts on closed resources', () => {
      const closedFinding = { id: 1, status: 'closed', resourceType: 'audit_finding' };
      // Simulates attempt to modify a closed finding
      expect(() => checkBlockClosure(closedFinding)).toThrow();
    });

    it('should block modification attempts on archived resources', () => {
      const archivedDecision = { id: 2, status: 'archived', resourceType: 'governance_decision' };
      expect(() => checkBlockClosure(archivedDecision)).toThrow();
    });

    it('should block modification attempts on completed resources', () => {
      const completedEngagement = { id: 3, status: 'completed', resourceType: 'audit_engagement' };
      expect(() => checkBlockClosure(completedEngagement)).toThrow();
    });

    it('should block modification attempts on cancelled resources', () => {
      const cancelledAction = { id: 4, status: 'cancelled', resourceType: 'audit_action' };
      expect(() => checkBlockClosure(cancelledAction)).toThrow();
    });

    it('should allow modification on draft resources', () => {
      const draftFinding = { id: 5, status: 'draft', resourceType: 'audit_finding' };
      expect(() => checkBlockClosure(draftFinding)).not.toThrow();
    });

    it('should allow modification on in-progress resources', () => {
      const inProgressAction = { id: 6, status: 'in_progress', resourceType: 'audit_action' };
      expect(() => checkBlockClosure(inProgressAction)).not.toThrow();
    });
  });

  describe('error message clarity', () => {
    it('BlockClosureError should provide actionable message', () => {
      const err = new BlockClosureError(99, 'audit_action', 'closed', ['closed', 'cancelled']);
      expect(err.details.reason).toContain('Cannot modify');
      expect(err.details.reason).toContain('closed');
      expect(err.details.reason).toContain('audit_action');
    });
  });
});
