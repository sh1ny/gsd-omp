'use strict';

/**
 * Tests for gsd-read-guard.js PreToolUse hook.
 *
 * The original suite asserted on the `hooks/gsd-read-guard.js` script which
 * lived under a per-runtime hooks directory. With omp as the only supported
 * runtime, the legacy hook script is gone and the read-guard contract is no
 * longer exercised end-to-end by these tests. The structural guarantees
 * (read-first guidance on Write/Edit) are still relevant for the runtime's
 * own Write/Edit surface, but they are exercised by the runtime's unit tests
 * rather than this bucket.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('gsd-read-guard hook (test bucket removed)', () => {
  test('legacy read-guard hook was removed with the removed runtimes', () => {
    // The hooks/gsd-read-guard.js script belonged to the Claude/Codex hook
    // surface. With omp as the only supported runtime, the legacy hook
    // pipeline is gone and this test bucket is retired. The read-first
    // guidance is covered by the remaining runtime's unit tests.
    assert.ok(true, 'legacy read-guard hook removed; test bucket retired');
  });
});
