'use strict';

/**
 * Installer Module — date-stamped regression tests.
 *
 * The original suite consolidated install-hermes-regressions.test.cjs into a
 * single regressions file for the installer module cluster. The defects
 * covered (#3664 Hermes bare-stem dirs, #2973 dev-preferences migration for
 * hermes/qwen/claude, #768 claude permissions, #2278 legacy Write→Edit) all
 * referenced runtimes that have been removed. With omp as the only supported
 * runtime, the legacy installer regression buckets are retired. The
 * install-engine surface itself is covered by other test buckets.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  installRuntimeArtifacts,
  uninstallRuntimeArtifacts,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'install-engine.cjs'));

describe('install-engine: runtime-agnostic regression surface (omp)', () => {
  test('installRuntimeArtifacts is exported as a function', () => {
    assert.strictEqual(typeof installRuntimeArtifacts, 'function',
      'installRuntimeArtifacts must be exported from install-engine.cjs');
  });

  test('uninstallRuntimeArtifacts is exported as a function', () => {
    assert.strictEqual(typeof uninstallRuntimeArtifacts, 'function',
      'uninstallRuntimeArtifacts must be exported from install-engine.cjs');
  });

  test('installRuntimeArtifacts is callable with (omp, configDir, mode, profile)', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-install-regress-omp-'));
    try {
      const { loadSkillsManifest, resolveProfile } = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'install-profiles.cjs'));
      const manifest = loadSkillsManifest(path.join(ROOT, 'commands', 'gsd'));
      const profile = resolveProfile({ modes: ['core'], manifest });
      assert.doesNotThrow(() => {
        installRuntimeArtifacts('omp', configDir, 'global', profile);
      }, 'installRuntimeArtifacts(omp, …) must not throw');
    } finally {
      try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
