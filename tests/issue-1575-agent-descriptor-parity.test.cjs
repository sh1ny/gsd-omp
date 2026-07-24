'use strict';

// #1575 — Golden-parity harness (ADR-1235 §0).
//
// The original test suite asserted on a 7-runtime "descriptor-driven" set
// (cursor, windsurf, augment, trae, codebuddy, copilot, antigravity). All
// those runtimes were removed from the runtime catalog; with omp as the only
// supported runtime the parity matrix collapses to a single runtime, and the
// golden-parity assertions reduce to one install + applySurface round-trip
// against the same configDir. The returned agent set must be non-empty and
// the two paths must produce identical file lists and byte content.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const COMMANDS_GSD = path.join(ROOT, 'commands', 'gsd');

const { installRuntimeArtifacts } = require('../gsd-core/bin/lib/install-engine.cjs');
const { applySurface } = require('../gsd-core/bin/lib/surface.cjs');
const { loadSkillsManifest, resolveProfile } = require('../gsd-core/bin/lib/install-profiles.cjs');
const { resolveRuntimeArtifactLayout } = require('../gsd-core/bin/lib/runtime-artifact-layout.cjs');
const { cleanup } = require('./helpers.cjs');

function snapshotAgents(agentsDir) {
  const snap = new Map();
  if (!fs.existsSync(agentsDir)) return snap;
  for (const name of fs.readdirSync(agentsDir)) {
    if (!name.startsWith('gsd-')) continue;
    if (!name.endsWith('.md') && !name.endsWith('.agent.md')) continue;
    snap.set(name, fs.readFileSync(path.join(agentsDir, name), 'utf8'));
  }
  return snap;
}

const manifest = loadSkillsManifest(COMMANDS_GSD);
const profile = resolveProfile({ modes: ['full'], manifest });
const resolveAttribution = () => undefined;

describe('#1575 — golden-parity: surface path matches install path for omp (collapsed matrix)', () => {
  test('omp: surface agents byte-identical to install agents', (t) => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-1575-omp-'));
    t.after(() => { try { cleanup(configDir); } catch { /* best-effort */ } });

    installRuntimeArtifacts('omp', configDir, 'global', profile, resolveAttribution);

    const agentsDir = path.join(configDir, 'agents');
    const installSnap = snapshotAgents(agentsDir);
    assert.ok(installSnap.size > 0, 'omp install must produce at least one gsd-* agent');

    const layout = resolveRuntimeArtifactLayout('omp', configDir, 'global');
    applySurface(configDir, layout, manifest, undefined, undefined, { resolveAttribution });

    const surfaceSnap = snapshotAgents(agentsDir);
    const installFiles = [...installSnap.keys()].sort();
    const surfaceFiles = [...surfaceSnap.keys()].sort();
    assert.deepEqual(surfaceFiles, installFiles,
      `omp: file lists must match after surface. Install: [${installFiles.join(', ')}] Surface: [${surfaceFiles.join(', ')}]`);

    for (const [fileName, installContent] of installSnap) {
      assert.strictEqual(surfaceSnap.get(fileName), installContent,
        `omp/${fileName}: surface content must be byte-identical to install content`);
    }
  });
});
