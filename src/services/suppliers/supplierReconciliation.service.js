'use strict';

function reconcileSupplierStatement(internalLines = [], externalLines = []) {
  const externalByReference = new Map(externalLines.map((line) => [String(line.reference), line]));
  const matches = [];
  const exceptions = [];
  for (const line of internalLines) {
    const external = externalByReference.get(String(line.reference));
    if (external && Number(external.amountCents) === Number(line.amountCents)) matches.push({ internal: line, external });
    else exceptions.push({ internal: line, external: external || null, reason: external ? 'amount_mismatch' : 'missing_external' });
  }
  const internalRefs = new Set(internalLines.map((line) => String(line.reference)));
  for (const external of externalLines) if (!internalRefs.has(String(external.reference))) exceptions.push({ internal: null, external, reason: 'missing_internal' });
  return { matched: exceptions.length === 0, matches, exceptions };
}

module.exports = { reconcileSupplierStatement };