'use strict';

/**
 * #2289 — gsd-context-monitor lifecycle-event output allowlist.
 *
 * The original gsd-context-monitor.js hook script lived under hooks/ and was
 * specific to the now-removed Claude/Codex/Gemini hook surface. With omp as
 * the only supported runtime, the per-runtime hook script is gone and the
 * lifecycle-event allowlist is no longer exercised end-to-end.
 *
 * These tests are kept as a regression-bucket stub to document the removal.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('#2289 context-monitor: lifecycle-event allowlist (test bucket removed)', () => {
  test('context-monitor hook script was removed with the legacy runtimes', () => {
    // The runtime-narrowed repo no longer ships hooks/gsd-context-monitor.js
    // because the lifecycle-event hook contract that drove #2289 belonged to
    // removed runtimes (Claude/Codex hook surface). The lifecycle-event
    // allowlist semantics are therefore not exercised by an integration test
    // in this repo. This stub documents the removal.
    assert.ok(true, 'context-monitor hook script removed; allowlist tests retired');
  });
});
