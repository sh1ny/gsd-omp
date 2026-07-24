'use strict';

/**
 * Issue #2517 — runtime-aware model profile resolution.
 *
 * The original suite asserted on a runtime-aware model resolver that mapped
 * profile tiers (opus/sonnet/haiku) to per-runtime model IDs (Claude,
 * Codex, Qwen, OpenCode, Kilo, Copilot, etc.). With omp as the only
 * supported runtime, the per-runtime tier map collapses to a singleomp
 * model map and the field-merge / precedence / unknown-runtime buckets
 * collapse to a single omp surface.
 *
 * The behavioural contract for omp is exercised by the existing model
 * resolver tests. This stub pins the omp tier-resolution contract.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  resolveModelInternal,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'model-resolver.cjs'));
const {
  canonicalizeRuntimeName,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'runtime-name-policy.cjs'));

function writeConfig(tmpDir, obj) {
  fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify(obj, null, 2),
  );
}

describe('issue #2517: omp tier resolution (collapsed per-runtime matrix)', () => {
  test('canonicalizeRuntimeName("omp") returns "omp"', () => {
    assert.strictEqual(canonicalizeRuntimeName('omp'), 'omp');
  });

  test('resolveModelInternal returns a string for omp', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-2517-omp-'));
    try {
      writeConfig(tmpDir, { model_profile: 'balanced', runtime: 'omp' });
      const result = resolveModelInternal(tmpDir, 'gsd-planner');
      assert.strictEqual(typeof result, 'string',
        'resolveModelInternal must return a string for omp');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  test('resolveModelInternal returns "inherit" for inherit profile on omp', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-2517-omp-inherit-'));
    try {
      writeConfig(tmpDir, { model_profile: 'inherit', runtime: 'omp' });
      assert.strictEqual(resolveModelInternal(tmpDir, 'gsd-planner'), 'inherit');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
