'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pkg = require('../package.json');
const { createTempDir, cleanup } = require('./helpers.cjs');

const installScript = path.join(__dirname, '..', 'bin', 'install.js');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeFile(root, relPath, content) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function writeManifest(root, files) {
  fs.writeFileSync(
    path.join(root, 'gsd-file-manifest.json'),
    JSON.stringify({
      version: '1.49.0',
      timestamp: '2026-05-10T00:00:00.000Z',
      mode: 'full',
      files,
    }, null, 2),
    'utf8'
  );
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function runInstallerCli(targetDir, options = {}) {
  const { minimal = true } = options;
  const home = path.join(path.dirname(targetDir), 'home');
  return spawnSync(
    process.execPath,
    [
      installScript,
      '--omp',
      '--global',
      '--config-dir',
      targetDir,
      ...(minimal ? ['--minimal'] : []),
      '--no-sdk',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home, GSD_TEST_MODE: '' },
    }
  );
}

function listDirNames(root, relPath) {
  const dir = path.join(root, relPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
}

function assertFreshOmpInstall(targetDir) {
  assert.equal(fs.readFileSync(path.join(targetDir, 'gsd-core', 'VERSION'), 'utf8'), pkg.version);
  assert.ok(fs.existsSync(path.join(targetDir, 'gsd-core', 'bin', 'gsd-tools.cjs')));
  const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'gsd-file-manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.mode, 'full');
  assert.ok(manifest.files['gsd-core/VERSION']);
  assert.ok(listDirNames(targetDir, 'commands').some((name) => name.startsWith('gsd-') && name.endsWith('.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'skills', 'gsd-ns-workflow', 'skills', 'plan-phase', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'agents', 'gsd-planner.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'rules', 'gsd-planning-artifacts.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'extensions', 'gsd-core', 'index.js')));
}

describe('installer migration install integration — OMP', { concurrency: false }, () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = createTempDir('gsd-install-migrations-omp-');
  });

  afterEach(() => {
    cleanup(tmpRoot);
  });

  test('runs a full end-to-end install after managed cleanup migration', () => {
    const targetDir = path.join(tmpRoot, '.omp-full-install');
    fs.mkdirSync(targetDir, { recursive: true });
    writeFile(targetDir, 'hooks/statusline.js', 'legacy managed hook\n');
    writeManifest(targetDir, {
      'hooks/statusline.js': sha256('legacy managed hook\n'),
    });

    const result = runInstallerCli(targetDir, { minimal: false });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    assert.match(output, /Installing for /);
    assert.match(output, /Installer migrations/);
    assert.match(output, /removed\s+hooks\/statusline\.js/);
    assert.match(output, /Installed workflow assets/);
    assert.match(output, /Done!/);
    assert.equal(fs.existsSync(path.join(targetDir, 'hooks/statusline.js')), false);
    const installState = JSON.parse(fs.readFileSync(path.join(targetDir, 'gsd-install-state.json'), 'utf8'));
    assert.ok(installState.appliedMigrations.some((entry) => entry.id === '2026-05-11-legacy-orphan-files'));
    assertFreshOmpInstall(targetDir);
  });

  test('blocks ambiguous GSD-looking user-choice artifacts before materialization', () => {
    const targetDir = path.join(tmpRoot, '.omp-blocked');
    fs.mkdirSync(targetDir, { recursive: true });
    writeFile(targetDir, 'gsd-core/gsd-retired-tool.cjs', 'old ambiguous artifact\n');

    const result = runInstallerCli(targetDir);

    assert.notEqual(result.status, 0);
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    assert.match(output, /Installer migrations/);
    assert.match(output, /blocked\s+gsd-core\/gsd-retired-tool\.cjs/);
    assert.match(output, /installer migration blocked/);
    assert.equal(fs.readFileSync(path.join(targetDir, 'gsd-core/gsd-retired-tool.cjs'), 'utf8'), 'old ambiguous artifact\n');
    assert.equal(fs.existsSync(path.join(targetDir, 'gsd-core', 'VERSION')), false);
  });
});
