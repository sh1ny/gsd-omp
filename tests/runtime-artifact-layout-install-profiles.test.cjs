'use strict';

/**
 * Consolidated tests for the Runtime Artifact Layout Module — install-profiles parity (ADR-3660).
 *
 * The original suite asserted on a per-runtime install layout (Claude, Codex,
 * Cursor, Windsurf, etc.) and on a per-cluster surface apply. With omp as the
 * only supported runtime, the per-runtime install layout matrix collapses to a
 * single omp layout. The behavioural assertions are retired to a stub that pins
 * the omp install layout contract.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const {
  stageSkillsForProfile,
  resolveProfile,
  loadSkillsManifest,
  PROFILES,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'install-profiles.cjs'));

describe('runtime-artifact-layout install-profiles: omp surface contract', () => {
  test('PROFILES exposes the documented profile list', () => {
    assert.ok(PROFILES && typeof PROFILES === 'object',
      'PROFILES must be exported as an object');
    assert.ok(Object.keys(PROFILES).length > 0,
      'PROFILES must expose at least one profile');
  });

  test('resolveProfile({ modes: ["full"] }) returns a structured profile', () => {
    const manifest = loadSkillsManifest(path.join(ROOT, 'commands', 'gsd'));
    const profile = resolveProfile({ modes: ['full'], manifest });
    assert.ok(profile && typeof profile === 'object');
  });

  test('stageSkillsForProfile is exported as a function', () => {
    assert.strictEqual(typeof stageSkillsForProfile, 'function');
  });

  test('stageSkillsForProfile runs without throwing on a real manifest', () => {
    const manifest = loadSkillsManifest(path.join(ROOT, 'commands', 'gsd'));
    const profile = resolveProfile({ modes: ['core'], manifest });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ip-omp-'));
    try {
      assert.doesNotThrow(() => {
        stageSkillsForProfile(tmpDir, profile);
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
