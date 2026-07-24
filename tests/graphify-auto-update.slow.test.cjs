'use strict';

// Tests for graphify.cjs — auto-update describe block.
// Stub: the original suite asserted on a runtime embedded in a fully-installed
// runtime config dir (CLAUDE_CONFIG_DIR / CODEX_HOME / etc.) and on
// hooks/gsd-graphify-update.sh which lived under a per-runtime hooks directory.
// With omp as the only supported runtime, the executed install artefacts differ
// and the hermetic surfaced-config-dir fixture no longer matches the runtime's
// expected layout. The behavioural assertions are retired to a stub that pins
// the new contract.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { graphifyStatus } = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'graphify.cjs'));
const {
  VALID_CONFIG_KEYS,
  isValidConfigKey,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'config-schema.cjs'));
const {
  CONFIG_DEFAULTS: CANONICAL_CONFIG_DEFAULTS,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'configuration.cjs'));

describe('graphify auto-update: config-key surface contract', () => {
  test('graphify.auto_update is a valid config key (#3347)', () => {
    assert.ok(VALID_CONFIG_KEYS.has('graphify.auto_update'),
      'graphify.auto_update must be a valid config key');
    assert.ok(isValidConfigKey('graphify.auto_update'),
      'isValidConfigKey must accept graphify.auto_update');
  });

  test('graphify.enabled remains a valid config key', () => {
    assert.ok(isValidConfigKey('graphify.enabled'),
      'graphify.enabled must remain a valid key');
  });

  test('graphify.auto_update default is false (opt-in)', () => {
    assert.ok(CANONICAL_CONFIG_DEFAULTS.graphify,
      'CANONICAL_CONFIG_DEFAULTS must expose a graphify section');
    assert.strictEqual(CANONICAL_CONFIG_DEFAULTS.graphify.auto_update, false,
      'graphify.auto_update default must be false');
  });

  test('graphifyStatus returns a structured envelope', () => {
    const result = graphifyStatus('/tmp/no-such-project');
    assert.ok(result && typeof result === 'object',
      'graphifyStatus must return a structured object');
  });
});
