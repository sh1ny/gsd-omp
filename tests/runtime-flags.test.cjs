'use strict';
/**
 * Tests for runtimeFlags (ADR-1239 Phase B / #1679 AC2). OMP-only fork:
 * exactly one flag (isOmp), omp sets it true, unknown/empty → all false, frozen.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtimeFlags } = require('../gsd-core/bin/lib/runtime-name-policy.cjs');
const registry = require('../gsd-core/bin/lib/capability-registry.cjs');

const EXPECTED_FLAGS = ['isOmp'];

test('runtimeFlags: omp sets exactly its own flag true', () => {
  const flags = runtimeFlags('omp');
  assert.strictEqual(flags.isOmp, true, 'omp must set isOmp true');
});

test('runtimeFlags: unknown / empty → all flags false (fail-closed)', () => {
  for (const id of ['claude', 'codex', 'unknown', '', 'claude-code']) {
    const flags = runtimeFlags(id);
    for (const f of EXPECTED_FLAGS) {
      assert.strictEqual(flags[f], false, `runtime '${id}': ${f} must be false`);
    }
  }
});

test('runtimeFlags: exactly 1 flag present + boolean + frozen', () => {
  const flags = runtimeFlags('omp');
  for (const f of EXPECTED_FLAGS) {
    assert.strictEqual(typeof flags[f], 'boolean', `${f} must be boolean`);
  }
  assert.deepStrictEqual(Object.keys(flags).sort(), [...EXPECTED_FLAGS].sort(), 'exactly the 1 flag');
  assert.ok(Object.isFrozen(flags), 'flags object must be frozen');
});

test('runtimeFlags drift guard: covers every registry runtime', () => {
  const flagToId = (flag) => flag.slice(2).toLowerCase();
  const registryRuntimes = Object.keys(registry.runtimes).sort();
  const flagIds = EXPECTED_FLAGS.map(flagToId).sort();
  const missing = registryRuntimes.filter((r) => !flagIds.includes(r));
  assert.deepEqual(missing, [], `registry runtimes missing a runtimeFlags entry: ${missing.join(', ')}`);
});
