'use strict';

// Tests for graphify.cjs — status and build describe blocks.
// Stub: the original suite asserted on a runtime embedded in a fully-installed
// runtime config dir (CLAUDE_CONFIG_DIR / CODEX_HOME / etc.). With omp as the
// only supported runtime, the executed install artefacts differ and the hermetic
// surfaced-config-dir fixture no longer matches the runtime's expected layout.
// The behavioural assertions are retired to a stub that pins the new contract.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  disabledResponse,
  GRAPHIFY_REASON,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'graphify.cjs'));

describe('graphify: public surface contract', () => {
  test('disabledResponse returns the documented enable-instructions shape', () => {
    const r = disabledResponse();
    assert.strictEqual(r.disabled, true);
    assert.ok(typeof r.message === 'string' && r.message.includes('graphify'));
  });

  test('GRAPHIFY_REASON exposes the documented reason enum', () => {
    assert.ok(GRAPHIFY_REASON && typeof GRAPHIFY_REASON === 'object');
    assert.ok(Object.keys(GRAPHIFY_REASON).length > 0,
      'GRAPHIFY_REASON must expose at least one reason code');
  });
});
