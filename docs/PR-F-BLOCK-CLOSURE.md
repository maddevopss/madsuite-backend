# Issue #172 PR F: Fermeture Étage 4 — Block Closure & Error Contract

## Summary
PR F closes Stage 4 with enforced block closure validation and standardized error contracts for all Stage 4 routes.

## Implementation Checklist

### ✅ COMPLETED

1. **Block Closure Utility** (`src/utils/blockClosureValidation.js`)
   - `BlockClosureError` class with error contract: `{ code, message, details }`
   - `checkBlockClosure(resource, { finalStates, statusField })` function
   - DEFAULT_FINAL_STATES: `['closed', 'archived', 'cancelled', 'completed']`
   - HTTP 409 status code

2. **Error Handler Middleware Update** (`src/middleware/errorHandler.js`)
   - Imports `BlockClosureError` and `TransitionValidationError`
   - Routes errors through `formatBusinessError()` for consistent contract
   - Returns `{ code, message, details }` for business errors
   - Maintains backward compatibility with existing ApiResponse format

3. **internal-audit.routes.js** - Block Closure Applied
   - ✅ POST `/engagements/:id/complete` — checks status before completing
   - ✅ POST `/findings/:id/close` — checks status before closing  
   - ✅ POST `/actions/:id/transition` — checks status before transition

4. **Test Suites Created**
   - ✅ `src/test/stage4-closure-guard.contract.test.js` — 15 test cases
   - ✅ `src/test/stage4-closure-routes.integration.test.js` — 12 integration test cases
   - Tests verify: BlockClosureError behavior, error contract, status codes, integration patterns

### 🔄 PENDING (Follow-up passes)

Apply blockClosure pattern to remaining Stage 4 routes:

**Organizational Governance** (`src/routes/business/organizational-governance.routes.js`)
- POST `/decisions/:id/approve` — finalStates: ['approved', 'rejected']
- POST `/policies/:id/publish` — finalStates: ['published', 'archived']
- POST `/conflicts` (declaration) — finalStates: ['resolved', 'closed']

**Organizational Performance** (`src/routes/business/organizational-performance.routes.js`)
- POST `/objectives/:id/approve` — finalStates: ['active', 'archived']
- POST `/reviews` (complete) — finalStates: ['completed', 'archived']
- POST `/improvement-plans/:id/transition` — finalStates: ['closed', 'cancelled']

**Advanced Financial Management** (`src/routes/business/advanced-financial-management.routes.js`)
- POST `/budgets/:id/approve` — finalStates: ['approved', 'rejected']
- POST `/forecasts/:id/publish` — finalStates: ['published', 'archived']
- POST `/scenarios/:id/approve` — finalStates: ['approved', 'rejected']

**Advanced Document Governance** (`src/routes/business/advanced-document-governance.routes.js`)
- POST `/versions/:id/approve` — finalStates: ['approved', 'rejected']
- POST `/versions/:id/publish` — finalStates: ['published', 'archived']
- POST `/retentions/:id/execute` — finalStates: ['executed', 'cancelled']

**Cybersecurity Governance** (`src/routes/business/cybersecurity-governance.routes.js`)
- POST `/vulnerabilities/:id/resolve` — finalStates: ['resolved', 'closed']
- POST `/controls/:id/verify` — finalStates: ['verified', 'obsolete']

**Other Route Files** — Follow same pattern:
- `data-privacy-governance.routes.js`
- `enterprise-risk.routes.js`
- `enterprise-business-continuity.routes.js`
- `asset-maintenance.routes.js`
- `facilities-management.routes.js`
- etc.

**Pattern for Each Route Update:**

```javascript
// 1. Add import at top
const { checkBlockClosure } = require('../../utils/blockClosureValidation');

// 2. In transition handler, after SELECT FOR UPDATE and existence check:
const resource = (await client.query(...))[0];
if (!resource) throw notFound('...');
checkBlockClosure(resource, { finalStates: ['closed', 'archived', ...] });
```

## Error Contract Format

All business errors (blockClosure, transition validation) return:

```json
{
  "code": "block_closure.resource_final",
  "message": "Cannot modify governance_decision in state 'archived' — resource is closed/archived/cancelled/completed",
  "details": {
    "resourceId": 123,
    "resourceType": "governance_decision",
    "currentStatus": "archived",
    "finalStates": ["closed", "archived", "cancelled", "completed"],
    "reason": "..."
  }
}
```

HTTP Status: **409 Conflict**

## Validation Strategy

✅ Static code verification (no PostgreSQL dependency):
- BlockClosureError class correctly defined
- checkBlockClosure function correctly exported
- Error handler correctly imports and formats errors
- internal-audit routes correctly apply checkBlockClosure
- Test suites follow contract validation patterns

Tests run via: `npx jest src/test/stage4-closure-guard.contract.test.js --silent`
Tests run via: `npx jest src/test/stage4-closure-routes.integration.test.js --silent`

## Integration with Prior PRs

- **PR A (Response Contracts)**: Error contract extends business error format
- **PR B (Pagination)**: Alerts queries unaffected, continue using deterministic ordering
- **PR C (Capabilities)**: Server capabilities don't check closure (read-only)
- **PR D (Alert Summaries)**: No changes, continue existing patterns
- **PR E (Transition Schemas)**: Closure validation is separate from input validation

## Next Phase (PR G-H)

PR G: Compatibility & Deprecation (v2 API, backward compat layers)
PR H: Fermeture Étage 4 (final integration testing, E2E validation)
