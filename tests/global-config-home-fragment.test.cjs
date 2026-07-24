'use strict';
/**
 * Drift-guard + collapse: getGlobalConfigHomeFragment must be the SINGLE source
 * of truth for the runtime → global config-home path-fragment mapping.
 *
 * OMP-only fork: one runtime (omp), one table entry, default fragment is
 * the omp fragment "'.omp', 'agent'".
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtimeNamePolicy = require('../gsd-core/bin/lib/runtime-name-policy.cjs');
const registry = require('../gsd-core/bin/lib/capability-registry.cjs');

const { getGlobalConfigHomeFragment } = runtimeNamePolicy;

const GOLDEN_FRAGMENT_MAP = {
  omp: "'.omp', 'agent'",
};

test('getGlobalConfigHomeFragment: golden map matches for omp', () => {
  for (const [id, expected] of Object.entries(GOLDEN_FRAGMENT_MAP)) {
    const actual = getGlobalConfigHomeFragment(id);
    assert.strictEqual(
      actual,
      expected,
      `getGlobalConfigHomeFragment('${id}') diverged from golden.\n` +
      `  actual:   ${JSON.stringify(actual)}\n` +
      `  expected: ${JSON.stringify(expected)}`,
    );
  }
});

test('getGlobalConfigHomeFragment fallback: unknown/empty return the default fragment', () => {
  assert.strictEqual(getGlobalConfigHomeFragment('unknown'), "'.omp', 'agent'",
    'unknown runtime must return the default fragment');
  assert.strictEqual(getGlobalConfigHomeFragment(''), "'.omp', 'agent'",
    'empty input must return the default fragment');
});

test('drift guard: every registry runtime has a table entry', () => {
  const tableIds = new Set(Object.keys(GOLDEN_FRAGMENT_MAP));
  const missing = Object.keys(registry.runtimes)
    .filter((id) => !tableIds.has(id));
  assert.deepEqual(missing, [],
    `registry runtimes missing a fragment table entry: ${missing.join(', ')}`);
});

test('drift guard: table keys are a subset of the registry (no stale entries)', () => {
  const registryIds = new Set(Object.keys(registry.runtimes));
  const stale = Object.keys(GOLDEN_FRAGMENT_MAP).filter((id) => !registryIds.has(id));
  assert.deepEqual(stale, [],
    `fragment table references runtimes not in the registry (stale entries): ${stale.join(', ')}`);
});
