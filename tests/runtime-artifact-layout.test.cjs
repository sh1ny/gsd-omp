'use strict';
/**
 * Consolidated tests for the Runtime Artifact Layout Module (ADR-3660) — layout seam.
 *
 * OMP-only fork: all removed-runtime layout tests deleted. Retains omp layout
 * structure tests, runtime-agnostic edge-cases, and .gsd-source marker tests.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveRuntimeArtifactLayout, findInstallSourceRoot } = require('../gsd-core/bin/lib/runtime-artifact-layout.cjs');
const installProfiles = require('../gsd-core/bin/lib/install-profiles.cjs');
const { install } = require('../bin/install.js');
const { createTempDir, cleanup } = require('./helpers.cjs');

const REPO_ROOT = path.join(__dirname, '..');

const FAKE_DIR = '/tmp/fake-config-dir';

// ─── resolveRuntimeArtifactLayout — structural shape ────────────────────────

describe('resolveRuntimeArtifactLayout — omp local', () => {
  test('returns correct layout for omp scope=local', () => {
    const layout = resolveRuntimeArtifactLayout('omp', FAKE_DIR, 'local');
    assert.strictEqual(layout.runtime, 'omp');
    assert.strictEqual(layout.configDir, FAKE_DIR);
    const kindNames = layout.kinds.map(k => k.kind);
    assert.ok(kindNames.includes('commands'), 'omp local must have commands kind');
    assert.ok(kindNames.includes('agents'), 'omp local must have agents kind');
    for (const kind of layout.kinds) {
      assert.strictEqual(typeof kind.stage, 'function', `${kind.kind} must have stage function`);
    }
  });
});

describe('resolveRuntimeArtifactLayout — omp global', () => {
  test('returns correct layout for omp scope=global', () => {
    const layout = resolveRuntimeArtifactLayout('omp', FAKE_DIR, 'global');
    assert.strictEqual(layout.runtime, 'omp');
    assert.strictEqual(layout.configDir, FAKE_DIR);
    const kindNames = layout.kinds.map(k => k.kind);
    assert.ok(kindNames.includes('skills'), 'omp global must have skills kind');
    for (const kind of layout.kinds) {
      assert.strictEqual(typeof kind.stage, 'function', `${kind.kind} must have stage function`);
    }
  });
});

// ─── resolveRuntimeArtifactLayout edge-cases ────────────────────────────────

describe('resolveRuntimeArtifactLayout edge-cases', () => {
  test('omp global has skills kind', () => {
    const layout = resolveRuntimeArtifactLayout('omp', '/tmp/x', 'global');
    const kindNames = layout.kinds.map(k => k.kind);
    assert.ok(kindNames.includes('skills'), 'omp global must have skills kind');
  });

  test('omp local has both commands and agents kinds', () => {
    const layout = resolveRuntimeArtifactLayout('omp', '/tmp/x', 'local');
    const kindNames = layout.kinds.map(k => k.kind);
    assert.ok(kindNames.includes('commands'), 'should have commands kind');
    assert.ok(kindNames.includes('agents'), 'should have agents kind');
  });

  test('unknown runtime grok throws TypeError containing runtime name', () => {
    assert.throws(
      () => resolveRuntimeArtifactLayout('grok', '/tmp/x'),
      (err) => {
        assert.ok(err instanceof TypeError);
        assert.ok(err.message.includes('grok'), 'error message must contain the runtime name');
        return true;
      }
    );
  });

  test('unknown runtime xyzunknown throws TypeError', () => {
    assert.throws(
      () => resolveRuntimeArtifactLayout('xyzunknown', '/tmp/x'),
      TypeError
    );
  });

  test('empty configDir throws TypeError', () => {
    assert.throws(
      () => resolveRuntimeArtifactLayout('omp', ''),
      TypeError
    );
  });

  test('non-string configDir throws TypeError', () => {
    assert.throws(
      () => resolveRuntimeArtifactLayout('omp', null),
      TypeError
    );
  });

  test('bad scope throws TypeError', () => {
    assert.throws(
      () => resolveRuntimeArtifactLayout('omp', '/x', 'invalid'),
      TypeError
    );
  });
});

// ─── kind.stage() invocations ────────────────────────────────────────────────

const CORE_SKILLS = new Set(['help', 'phase', 'new-project']);
const CORE_AGENTS = new Set(['gsd-planner']);
const PROFILE_FULL = { skills: '*', agents: new Set() };
const FAKE_STAGE_DIR = '/tmp/fake-config-dir-stage';

describe('stage — agents kind (omp local)', () => {
  test('stage returns a valid directory for the agents kind', () => {
    const layout = resolveRuntimeArtifactLayout('omp', FAKE_STAGE_DIR, 'local');
    const agentsKind = layout.kinds.find(k => k.kind === 'agents');
    assert.ok(agentsKind, 'should have an agents kind');

    const stagedDir = agentsKind.stage(PROFILE_FULL);
    assert.ok(stagedDir, 'stage() must return a directory');
  });
});

describe('stage — skills kind (omp global)', () => {
  test('stage returns a valid directory for the skills kind', () => {
    const layout = resolveRuntimeArtifactLayout('omp', FAKE_STAGE_DIR, 'global');
    const skillsKind = layout.kinds.find(k => k.kind === 'skills');
    assert.ok(skillsKind, 'should have a skills kind');

    const stagedDir = skillsKind.stage(PROFILE_FULL);
    assert.ok(stagedDir, 'stage() must return a directory');
  });
});

// ─── #1477 .gsd-source marker provisioning ────────────────────────────────────

describe('#1477 .gsd-source marker provisioning', () => {
  let tmpRoot;
  let savedHome;
  let savedUserProfile;
  let savedExplicitConfigDir;
  let savedTestMode;

  function silenceConsole(fn) {
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
  }

  // Guard against process.exit killing the runner mid-install.
  function runInstall(isGlobal, runtime) {
    const origExit = process.exit;
    let exitCalled = false;
    process.exit = (code) => {
      exitCalled = true;
      throw new Error(`process.exit(${code}) during install — should not happen`);
    };
    try {
      return silenceConsole(() => install(isGlobal, runtime));
    } catch (e) {
      if (exitCalled) assert.fail(`install() called process.exit — unexpected: ${e.message}`);
      throw e;
    } finally {
      process.exit = origExit;
    }
  }

  beforeEach(() => {
    tmpRoot = createTempDir('gsd-1477-');
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpRoot;
    process.env.USERPROFILE = tmpRoot;
    savedExplicitConfigDir = process.env.GSD_EXPLICIT_CONFIG_DIR;
    delete process.env.GSD_EXPLICIT_CONFIG_DIR;
    savedTestMode = process.env.GSD_TEST_MODE;
    process.env.GSD_TEST_MODE = '1';
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedExplicitConfigDir === undefined) delete process.env.GSD_EXPLICIT_CONFIG_DIR;
    else process.env.GSD_EXPLICIT_CONFIG_DIR = savedExplicitConfigDir;
    if (savedTestMode === undefined) delete process.env.GSD_TEST_MODE;
    else process.env.GSD_TEST_MODE = savedTestMode;
    cleanup(tmpRoot);
  });

  // ── Failure 1: the installer provisions a valid profile marker ───────────────
  test('global omp install writes a .gsd-profile marker', () => {
    const ompDir = path.join(tmpRoot, '.omp');
    fs.mkdirSync(ompDir, { recursive: true });

    runInstall(true /* isGlobal */, 'omp');

    // Find the .gsd-profile marker somewhere under .omp/
    let markerPath = null;
    function findMarker(dir, depth) {
      if (depth > 5) return null;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
      for (const e of entries) {
        if (e.name === '.gsd-profile') return path.join(dir, e.name);
        if (e.isDirectory()) {
          const found = findMarker(path.join(dir, e.name), depth + 1);
          if (found) return found;
        }
      }
      return null;
    }
    markerPath = findMarker(ompDir, 0);
    assert.ok(markerPath, `.gsd-profile marker must be written under ${ompDir}`);
  });

  // ── Adversarial marker-reader cases (no full install needed) ─────────────────
  describe('findInstallSourceRoot marker handling', () => {
    let cfgDir;
    beforeEach(() => { cfgDir = createTempDir('gsd-1477-marker-'); });
    afterEach(() => { cleanup(cfgDir); });

    test('marker pointing at a valid commands/gsd takes precedence over walk-up', () => {
      const fakeSrc = path.join(cfgDir, 'pkg', 'commands', 'gsd');
      fs.mkdirSync(fakeSrc, { recursive: true });
      fs.writeFileSync(path.join(cfgDir, '.gsd-source'), fakeSrc + '\n', 'utf8');

      const resolved = findInstallSourceRoot(cfgDir);
      assert.equal(path.resolve(resolved), path.resolve(fakeSrc),
        'marker target must win over the repo walk-up');
    });

    test('marker pointing at a non-existent path is ignored (falls through to walk-up)', () => {
      const ghost = path.join(cfgDir, 'does', 'not', 'exist', 'commands', 'gsd');
      fs.writeFileSync(path.join(cfgDir, '.gsd-source'), ghost + '\n', 'utf8');

      const resolved = findInstallSourceRoot(cfgDir);
      assert.notEqual(path.resolve(resolved), path.resolve(ghost));
      assert.equal(path.resolve(resolved), path.resolve(REPO_ROOT, 'commands', 'gsd'));
    });

    test('empty / whitespace-only marker is ignored', () => {
      fs.writeFileSync(path.join(cfgDir, '.gsd-source'), '   \n', 'utf8');
      const resolved = findInstallSourceRoot(cfgDir);
      assert.equal(path.resolve(resolved), path.resolve(REPO_ROOT, 'commands', 'gsd'));
    });
  });
});
