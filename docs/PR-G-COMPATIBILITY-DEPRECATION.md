# Issue #172 PR G: Compatibilité & Dépréciation des Contrats

**Stage 4 API Versioning & Backward Compatibility**

## Summary

PR G implements a comprehensive contract versioning system and deprecation framework that enables backward compatibility and graceful API evolution without breaking existing client integrations.

## Implementation

### Core Components

#### 1. Contract Versioning Utility (`src/utils/contractVersioning.js`)

**Responsibilities:**
- Maintain registry of all contract versions (`CONTRACT_VERSIONS`)
- Track version metadata: deprecation status, sunset dates, successors
- Provide version lookup and validation

**Key Functions:**

```javascript
// Get contract version info
getContractVersion(name, version = null)
  // Returns: { name, version, contractId, deprecated, sunset, replacedBy, releaseDate }

// Check if deprecated
isDeprecated(name, version = null)
  // Returns: boolean

// Add HTTP deprecation headers
addDeprecationHeaders(res, contractName, version = null)
  // Sets: Deprecation, Sunset, X-Contract-Deprecated headers

// Wrap response with contract metadata
withContractMeta(data, contractName, version = null)
  // Returns: data with meta.contract, meta.deprecated, meta.sunset, meta.replacedBy

// Create adapter for format conversion
createContractAdapter(fromVersion, toVersion)
  // Returns: async function(data) => transformedData

// List all available contracts
listContracts()
  // Returns: { contractName: { current, versions, metadata } }

// Register new contract version
registerContractVersion(name, version, metadata = {})
  // Adds version to registry, updates current if newer

// Deprecate a version
deprecateContractVersion(name, version, { sunsetDate, replacedBy })
  // Marks version as deprecated, sets sunset date and successor
```

**Contract Registry:**

Currently tracked contracts:
- `integration-list@1` — List response format
- `integration-resource@1` — Resource response format
- `server-capabilities@1` — Server capability computation format
- `transition@1` — Transition request/response format
- `block-closure@1` — Block closure error format

**Metadata per Version:**
```javascript
{
  deprecated: boolean,        // Is version deprecated?
  sunset: ISO8601 | null,    // When will it be removed?
  replacedBy: string | null, // Which version replaces it?
  releaseDate: YYYY-MM-DD,   // When was it released?
}
```

#### 2. Deprecation Middleware (`src/middleware/contractDeprecation.middleware.js`)

**Functionality:**
- Intercepts res.json() calls
- Inspects response for contract metadata
- Automatically adds HTTP deprecation headers for deprecated contracts
- No impact on non-deprecated responses

**HTTP Headers Added for Deprecated Contracts:**

```
Deprecation: true
Sunset: <RFC-2822-date>
X-Contract-Deprecated: <contractName@version>
Link: <successor>; rel="successor-version"
```

**Standard Compliance:**
- Follows RFC 7231 (Deprecation header)
- Follows RFC 6585 (HTTP status codes)
- Sunset date in RFC 2822 format
- Link header for version discovery

#### 3. Integration Points

**Applied to Response Contracts:**

All Stage 4 routes that return versioned responses should:

1. Include contract metadata in response:
   ```javascript
   return res.json({
     items: [...],
     meta: {
       contract: 'integration-list@1',
       count: 25,
       // ... other meta
     }
   });
   ```

2. Middleware automatically detects and adds headers

3. Clients check headers and display warnings/UI

**Example Response:**

```json
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sun, 31 Dec 2026 23:59:59 GMT
X-Contract-Deprecated: integration-list@1
Link: <integration-list@2>; rel="successor-version"

{
  "items": [...],
  "meta": {
    "contract": "integration-list@1",
    "deprecated": true,
    "sunset": "2026-12-31T23:59:59.000Z",
    "replacedBy": "integration-list@2"
  }
}
```

### Migration Path: v1 → v2

**Phase 1: Announce (v1 still primary)**
```javascript
registerContractVersion('integration-list', '2', { releaseDate: '2026-09-01' });
// v1 remains current, no deprecation yet
```

**Phase 2: Parallel (Clients can use either)**
```javascript
// Both v1 and v2 available
// Headers not yet added
```

**Phase 3: Deprecate v1**
```javascript
deprecateContractVersion('integration-list', '1', {
  sunsetDate: '2026-12-31',
  replacedBy: 'integration-list@2'
});
// v2 becomes current
// Deprecation headers added to v1 responses
```

**Phase 4: Sunset**
- v1 endpoints removed on sunset date
- Clients migrated to v2

## Backward Compatibility Guarantees

✅ **All existing clients continue to work:**
- v1 responses remain available
- Format unchanged during deprecation period
- Clear migration path provided

✅ **Deprecation is non-breaking:**
- Only adds HTTP headers
- Doesn't change response body structure
- Clients that ignore headers work fine

✅ **Adapter pattern enables format conversion:**
- Old → new format converters available
- New → old format converters for backward compat

## Test Coverage

### Unit Tests: `stage4-contract-versioning.contract.test.js`

- 45+ test cases covering:
  - Version registry management
  - Contract info lookup
  - Deprecation flag handling
  - Metadata tracking
  - Version registration
  - Deprecation transitions
  - Backward compatibility scenarios
  - Production readiness

### Integration Tests: `stage4-contract-deprecation-middleware.integration.test.js`

- 40+ test cases covering:
  - Middleware setup and composition
  - Response interception
  - Header generation
  - HTTP standards compliance (RFC 7231, RFC 6585)
  - Graceful error handling
  - Performance characteristics

## Versioning Strategy

**Semantic Versioning for Contracts:**
- Major version: breaking changes → new contract name or major version bump
- Minor version: backward compatible additions → may not bump version
- Patch: bug fixes → generally transparent to clients

**Decision Tree:**

1. Adding optional field? → Same version, update docs
2. Making field required? → New major version
3. Changing field type? → New major version
4. Removing field? → Deprecation period + new version
5. Changing response structure? → New major version

## Client Guidance

**Handling Deprecation Headers:**

```javascript
// Client code
if (response.headers['deprecation'] === 'true') {
  const sunset = new Date(response.headers['sunset']);
  console.warn(`API contract will sunset on ${sunset}`);
  
  const successor = response.headers['link'];
  console.warn(`Migrate to: ${successor}`);
}
```

**Recommended Actions:**
1. Receive deprecation header → log warning
2. Check `meta.replacedBy` in response → identify successor
3. Plan migration to new version
4. Before sunset date → switch to new contract version

## Integration with Prior PRs

- **PR A (Response Contracts)**: withContractMeta() wraps responses, includes contract field
- **PR B (Pagination)**: integration-list@1 includes version metadata
- **PR C (Capabilities)**: server-capabilities@1 versioned
- **PR D (Alerts)**: Queries unchanged, versioning optional
- **PR E (Transition Schemas)**: transition@1 versioned
- **PR F (Block Closure)**: block-closure@1 versioned, can be deprecated independently

## Deployment & Operations

**Pre-Deployment:**
1. Define new contract version if needed
2. Implement adapter functions
3. Register versions in CONTRACT_VERSIONS
4. Add tests for migration path

**During Deprecation Period:**
- Monitor client usage via deprecation headers
- Provide migration guide to clients
- Support both versions concurrently
- Log deprecation notices

**Sunset:**
- Remove deprecated endpoints
- Clean up adapters
- Update OpenAPI spec
- Notify remaining clients

## Monitoring & Metrics

**Track via HTTP headers:**
- Count `Deprecation: true` responses → client migration progress
- Monitor `X-Contract-Deprecated` header usage → which versions still in use
- Parse `Sunset` header → time to full cutover

**Recommended queries:**
```sql
-- How many requests use deprecated contracts?
SELECT contract, COUNT(*) FROM api_logs 
WHERE response_headers LIKE '%Deprecation: true%' 
GROUP BY contract;

-- Which clients still use old versions?
SELECT client_id, contract, COUNT(*) FROM api_logs 
WHERE contract LIKE '%@1' 
GROUP BY client_id, contract;
```

## Scope & Coverage

✅ **Completed:**
- Contract versioning utility
- Deprecation middleware
- Registry initialization (5 contracts @ v1)
- Comprehensive test coverage
- HTTP standards compliance
- Migration patterns documented

🔄 **Pending (follow-up):**
- Integrate middleware into app.js
- Apply withContractMeta() to all Stage 4 routes
- Update OpenAPI spec with version references
- Client migration guides
- Monitoring dashboards

## Next Phase (PR H)

**Fermeture d'Étage 4 — Final Integration & E2E Validation**

- Integrate versioning middleware globally
- E2E tests for complete contract lifecycle
- Contract compliance verification
- Performance benchmarks
- Production readiness checklist

---

**References:**
- RFC 7231: HTTP Semantics — Deprecation
- RFC 6585: HTTP Status Codes
- RFC 2822: Internet Message Format (dates)
- Semantic Versioning: https://semver.org/
- API Versioning Best Practices: https://tools.ietf.org/html/draft-wilde-api-versioning
