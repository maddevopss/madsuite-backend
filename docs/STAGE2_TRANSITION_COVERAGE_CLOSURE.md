# Stage 2 transition coverage closure

Issue: #170.

This closure records the automated contract added for the Stage 2 institutional transition block.

The guard `npm run guard:stage2-transition-coverage` checks that every Stage 2 transition policy is:

- registered with `registerPolicy(..., '1', ...)`;
- referenced by a real business route;
- covered by a backend contract test;
- protected by the route markers required by the issue, including transactional execution, server-side policy evaluation, `FOR UPDATE`, or server authority resolution where applicable.

Covered transitions:

- `risk.control.transition@1`
- `risk.treatment.transition@1`
- `risk.review.transition@1`
- `cybersecurity.vulnerability.transition@1`
- `audit.engagement.complete@1`
- `audit.action.transition@1`
- `audit.finding.close@1`
- `governance.committee.meeting.complete@1`
- `governance.policy.publish@1`
- `governance.authority.validate@1`
- `governance.decision.approve@1`
- `finance.budget.approve@1`
- `finance.forecast.publish@1`
- `finance.scenario.approve@1`
- `documents.document.publish@1`
- `documents.retention.execute@1`
- `facilities.asset.decommission@1`
- `performance.objective.approve@1`

The backend must not re-open Stage 2 by keeping one of these policies registered without an explicit route and matching test.
