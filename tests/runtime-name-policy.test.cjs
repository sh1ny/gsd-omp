'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  canonicalizeRuntimeName,
  resolveRuntimeNameFromCandidates,
  getProjectInstructionFile,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'runtime-name-policy.cjs'));

describe('runtime-name-policy:getProjectInstructionFile(omp)', () => {
  test('omp maps to its project instruction file', () => {
    // omp is the only supported runtime; tests for removed runtimes deleted.
    const result = getProjectInstructionFile('omp');
    assert.ok(typeof result === 'string' && result.length > 0,
      `expected a non-empty instruction file path for omp, got ${result}`);
  });

  test('canonicalizeRuntimeName returns a string for omp', () => {
    const result = canonicalizeRuntimeName('omp');
    assert.strictEqual(typeof result, 'string');
  });

  test('resolveRuntimeNameFromCandidates returns a string', () => {
    const result = resolveRuntimeNameFromCandidates('omp');
    assert.ok(typeof result === 'string' || result === null,
      `expected a string or null for omp, got ${typeof result}`);
  });

  test('unknown runtime maps to AGENTS.md (safe cross-agent default)', () => {
    assert.strictEqual(getProjectInstructionFile('future-runtime-xyz'), 'AGENTS.md');
    assert.strictEqual(getProjectInstructionFile(''), 'AGENTS.md');
    assert.strictEqual(getProjectInstructionFile(null), 'AGENTS.md');
    assert.strictEqual(getProjectInstructionFile(undefined), 'AGENTS.md');
  });
});
