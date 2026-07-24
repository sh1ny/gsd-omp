/**
 * GSD Tools Tests - MODEL_ALIAS_MAP
 *
 * OMP-only fork: MODEL_ALIAS_MAP is empty (omp doesn't use Claude agent aliases).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { MODEL_ALIAS_MAP } = require('../gsd-core/bin/lib/model-catalog.cjs');

describe('MODEL_ALIAS_MAP (omp-only — empty map)', () => {
  test('MODEL_ALIAS_MAP is empty (omp has 3 tier aliases with undefined values)', () => {
    assert.equal(Object.keys(MODEL_ALIAS_MAP).length, 3);
  });
});
