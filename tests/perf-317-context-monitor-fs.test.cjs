'use strict';

/**
 * Behavior-lock tests for perf #317 — context-monitor hook fs I/O collapse.
 *
 * The original suite asserted on the `hooks/gsd-context-monitor.js` script
 * which lived under a per-runtime hooks directory. With omp as the only
 * supported runtime, the legacy hook script is gone and the perf-collapse
 * contract is no longer exercised end-to-end. The structural guarantees
 * (try/catch around ENOENT, no double-fsync) still apply to any remaining
 * fs I/O in the runtime stack, but they are exercised by the runtime's
 * own unit tests rather than this bucket.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('perf #317: context-monitor hook fs I/O collapse (test bucket removed)', () => {
  test('legacy context-monitor hook was removed with the removed runtimes', () => {
    // The hooks/gsd-context-monitor.js script belonged to the Claude/Codex
    // hook surface. With omp as the only supported runtime, the legacy hook
    // pipeline is gone and this perf-bucket is retired. The behavior is
    // covered by the remaining runtime's unit tests.
    assert.ok(true, 'legacy context-monitor hook removed; perf #317 bucket retired');
  });
});
