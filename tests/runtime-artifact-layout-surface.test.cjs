'use strict';

/**
 * Runtime Artifact Layout Module (ADR-3660) — surface seam.
 *
 * The original suite asserted on a per-runtime surface apply (Claude, Codex,
 * Cursor, Windsurf, etc.). With omp as the only supported runtime, the
 * per-runtime surface matrix collapses to a single omp surface. The behavioural
 * assertions are retired to a stub that pins the omp surface contract.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const { canonicalizeRuntimeName } = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'runtime-name-policy.cjs'));
const { resolveRuntimeArtifactLayout } = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'runtime-artifact-layout.cjs'));

describe('runtime-artifact-layout: omp surface contract', () => {
  test('canonicalizes omp aliases', () => {
    assert.strictEqual(canonicalizeRuntimeName('omp'), 'omp');
    assert.strictEqual(canonicalizeRuntimeName('oh-my-pi'), 'omp');
    assert.strictEqual(canonicalizeRuntimeName('oh_my_pi_cli'), 'omp');
  });

  test('resolveRuntimeArtifactLayout returns a structured layout for omp', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ral-omp-'));
    try {
      const layout = resolveRuntimeArtifactLayout('omp', tmpDir, 'global');
      assert.ok(layout && typeof layout === 'object',
        'resolveRuntimeArtifactLayout must return a structured object');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
