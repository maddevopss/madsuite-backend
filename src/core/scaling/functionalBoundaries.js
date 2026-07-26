'use strict';

function validateFunctionalBoundaries(boundaries = []) {
  const names = new Set();
  for (const boundary of boundaries) {
    if (!boundary.name || names.has(boundary.name)) throw new Error('invalid_or_duplicate_boundary');
    names.add(boundary.name);
    if (!Array.isArray(boundary.contracts) || !Array.isArray(boundary.events)) {
      throw new Error(`boundary_contract_missing:${boundary.name}`);
    }
    if (boundary.distributed === true && !boundary.demonstratedGain) {
      throw new Error(`distribution_without_demonstrated_gain:${boundary.name}`);
    }
  }
  const dependencies = new Map(boundaries.map(item => [item.name, item.dependsOn || []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visiting.has(name)) throw new Error(`circular_dependency:${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) || []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of dependencies.keys()) visit(name);
  return { contract: 'functional-boundaries@1', boundaries: boundaries.length, valid: true };
}

module.exports = { validateFunctionalBoundaries };
