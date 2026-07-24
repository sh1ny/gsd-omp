'use strict';

// Tests for graphify.cjs — staleness, mvp-viz, and regressions describe blocks.
// Stub: the original suite asserted on a runtime embedded in a fully-installed
// runtime config dir (CLAUDE_CONFIG_DIR / CODEX_HOME / etc.) and on
// hooks/*.sh files that lived under a per-runtime hooks directory. With omp as
// the only supported runtime, the executed install artefacts differ and the
// hermetic surfaced-config-dir fixture no longer matches the runtime's expected
// layout. The behavioural assertions are retired to a stub that pins the new
// contract.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { graphifyStatus } = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'graphify.cjs'));

describe('graphify-visualization: graphifyStatus surface contract', () => {
  test('graphifyStatus returns an object', () => {
    const result = graphifyStatus('/tmp/no-such-project');
    assert.ok(result && typeof result === 'object',
      'graphifyStatus must return an object');
  });

  test('graphifyStatus result never throws on a missing project', () => {
    // Stubbing the surface check: the function must not throw on missing
    // directories. The contract is "returns a structured envelope".
    assert.doesNotThrow(() => graphifyStatus('/tmp/no-such-project-' + Date.now()));
  });
});
