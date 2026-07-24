'use strict';

process.env.GSD_TEST_MODE = '1';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempDir, cleanup } = require('./helpers.cjs');
const { installRuntimeArtifacts, uninstallRuntimeArtifacts } = require('../gsd-core/bin/lib/install-engine.cjs');
const { resolveRuntimeArtifactLayout } = require('../gsd-core/bin/lib/runtime-artifact-layout.cjs');
const { loadSkillsManifest, resolveProfile } = require('../gsd-core/bin/lib/install-profiles.cjs');

const commandsDir = path.join(__dirname, '..', 'commands', 'gsd');
const manifest = loadSkillsManifest(commandsDir);

describe('installRuntimeArtifacts — OMP multi-surface layout', () => {
  test('writes commands, nested skills, agents, rules, and extension package', (t) => {
    const configDir = createTempDir('gsd-omp-artifacts-');
    t.after(() => cleanup(configDir));

    const profile = resolveProfile({ modes: ['full'], manifest });
    installRuntimeArtifacts('omp', configDir, 'local', profile);

    assert.ok(fs.existsSync(path.join(configDir, 'commands', 'gsd-help.md')));
    assert.ok(fs.existsSync(path.join(configDir, 'skills', 'gsd-ns-workflow', 'skills', 'plan-phase', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(configDir, 'skills', 'gsd-plan-phase', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(configDir, 'agents', 'gsd-planner.md')));
    assert.ok(fs.existsSync(path.join(configDir, 'rules', 'gsd-planning-artifacts.md')));
    assert.ok(fs.existsSync(path.join(configDir, 'extensions', 'gsd-core', 'index.js')));
    assert.ok(fs.existsSync(path.join(configDir, 'extensions', 'gsd-core', 'package.json')));
    assert.ok(fs.existsSync(path.join(configDir, 'extensions', 'gsd-core', 'update-worker.js')));
  });
});

describe('uninstallRuntimeArtifacts — OMP ownership', () => {
  test('removes GSD entries and preserves foreign entries', (t) => {
    const configDir = createTempDir('gsd-omp-uninstall-');
    t.after(() => cleanup(configDir));

    const profile = resolveProfile({ modes: ['full'], manifest });
    installRuntimeArtifacts('omp', configDir, 'local', profile);

    const foreignCommand = path.join(configDir, 'commands', 'user-command.md');
    const foreignSkill = path.join(configDir, 'skills', 'user-skill', 'SKILL.md');
    const foreignAgent = path.join(configDir, 'agents', 'user-agent.md');
    const foreignRule = path.join(configDir, 'rules', 'user-rule.md');
    const foreignExtension = path.join(configDir, 'extensions', 'user-extension', 'index.js');
    for (const file of [foreignCommand, foreignSkill, foreignAgent, foreignRule, foreignExtension]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '# user\n');
    }

    uninstallRuntimeArtifacts('omp', configDir, 'local');

    assert.ok(!fs.existsSync(path.join(configDir, 'commands', 'gsd-help.md')));
    assert.ok(!fs.existsSync(path.join(configDir, 'skills', 'gsd-ns-workflow')));
    assert.ok(!fs.existsSync(path.join(configDir, 'agents', 'gsd-planner.md')));
    assert.ok(!fs.existsSync(path.join(configDir, 'rules', 'gsd-planning-artifacts.md')));
    assert.ok(!fs.existsSync(path.join(configDir, 'extensions', 'gsd-core')));
    for (const file of [foreignCommand, foreignSkill, foreignAgent, foreignRule, foreignExtension]) {
      assert.ok(fs.existsSync(file), `${file} must be preserved`);
    }
  });

  test('layout resolver rejects an unknown runtime', () => {
    assert.throws(
      () => resolveRuntimeArtifactLayout('unknown-runtime', '/tmp/test', 'local'),
      /Unknown runtime|unknown runtime/i
    );
  });
});
