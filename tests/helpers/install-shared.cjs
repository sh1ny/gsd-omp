'use strict';

/**
 * Shared helpers and constants for the install test suites (OMP-only).
 *
 * Provides:
 *   - RUNTIME_META        — per-runtime local/global config-dir metadata (omp only)
 *   - installerEnv        — clean env builder for spawned installer processes
 *   - runMinimalInstall   — minimal real install driver (omp only)
 *   - manifestSkillSet    — collect skill basenames from a manifest
 *   - manifestAgentCount  — count agent files in a manifest
 *   - collectSkillBasenamesOnDisk — collect gsd-* skill/command basenames on disk
 *   - stripAnsi / walk    — small text + fs helpers
 *
 * OMP is the single supported runtime after the F1 capability-pruning phase
 * (ADR-857/ADR-1239 descriptor architecture). The 19 non-omp runtimes
 * (claude, codex, opencode, cursor, windsurf, kilo, kimi, hermes, qwen, trae,
 * augment, cline, codebuddy, copilot, antigravity, vscode, zcode) and the
 * hooks/parity infrastructure they required have been removed upstream.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const {
  resolveRuntimeArtifactLayout,
} = require('../../gsd-core/bin/lib/runtime-artifact-layout.cjs');

const INSTALL_SCRIPT = path.join(__dirname, '..', '..', 'bin', 'install.js');
const MANIFEST_NAME = 'gsd-file-manifest.json';

// ─── Runtime metadata table (OMP only) ────────────────────────────────────────

const RUNTIME_META = {
  omp: { localDir: '.omp', globalSuffix: path.join('.omp', 'agent') },
};

// ─── Helper functions ─────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else results.push(full);
  }
  return results;
}

/** Build a clean env for spawned installer processes.
 *  Must strip GSD_TEST_MODE so the child runs the real install, not the no-op guard. */
function installerEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.GSD_TEST_MODE;
  return env;
}

function runMinimalInstall({ runtime = 'omp', scope, extraArgs = [] } = {}) {
  if (runtime !== 'omp') {
    throw new Error(
      `runMinimalInstall: runtime '${runtime}' is not supported. this GSD fork supports OMP only`,
    );
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-${runtime}-${scope}-`));
  try {
    const localDir = RUNTIME_META.omp.localDir;
    let configDir;
    let cwd = process.cwd();
    const args = [INSTALL_SCRIPT, '--omp'];
    if (scope === 'global') {
      args.push('--global', '--config-dir', root);
      configDir = root;
    } else {
      args.push('--local');
      cwd = root;
      configDir = path.join(root, localDir);
    }
    args.push(...extraArgs);
    const result = spawnSync(process.execPath, args, {
      cwd, encoding: 'utf8',
      env: installerEnv({ HOME: root, USERPROFILE: root }),
    });
    assert.strictEqual(result.status, 0,
      `installer exited with status ${result.status} for ${runtime} --${scope}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const manifestPath = path.join(configDir, MANIFEST_NAME);
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : null;
    return { manifest, configDir, root, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

function manifestSkillSet(manifest) {
  if (!manifest || !manifest.files) return new Set();
  const out = new Set();
  for (const key of Object.keys(manifest.files)) {
    if (key.startsWith('skills/')) {
      // OMP: skills/gsd-<name>/SKILL.md (nested) or skills/gsd-<name>.md (flat)
      const seg = key.split('/')[1].replace(/^gsd-/, '').replace(/\.md$/, '');
      out.add(seg);
    } else if (key.startsWith('commands/') && key.split('/').length === 2) {
      // OMP local: flat commands/gsd-<cmd>.md
      const file = key.split('/')[1];
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        out.add(file.replace(/^gsd-/, '').replace(/\.md$/, ''));
      }
    }
  }
  return out;
}

function manifestAgentCount(manifest) {
  if (!manifest || !manifest.files) return 0;
  return Object.keys(manifest.files).filter((k) => k.startsWith('agents/')).length;
}

/**
 * Collect gsd-* skill/command basenames actually present on disk under configDir.
 *
 * OMP installs skills under <configDir>/skills/gsd-<name>/SKILL.md (nested) and
 * <configDir>/commands/gsd-<name>.md (flat commands). The optional `runtime`
 * argument is retained for compatibility with callers that parametrize by
 * runtime id, but only 'omp' is honored — any other value throws.
 *
 * @param {string} configDir
 * @param {string} [runtime='omp']
 * @param {string} [scope='global']
 */
function collectSkillBasenamesOnDisk(configDir, runtime = 'omp', scope = 'global') {
  if (runtime && runtime !== 'omp') {
    throw new Error(
      `collectSkillBasenamesOnDisk: runtime '${runtime}' is not supported. this GSD fork supports OMP only`,
    );
  }
  const out = new Set();
  let skillsDir = path.join(configDir, 'skills');
  try {
    const layout = resolveRuntimeArtifactLayout('omp', configDir, scope);
    const skillsKind = layout.kinds.find((k) => k.kind === 'skills');
    if (skillsKind) skillsDir = path.join(skillsKind.home || configDir, skillsKind.destSubpath);
  } catch { /* fall back to configDir/skills */ }
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('gsd-')) {
        out.add(entry.name.replace(/^gsd-/, ''));
      } else if (entry.isFile() && entry.name.startsWith('gsd-') && entry.name.endsWith('.md')) {
        out.add(entry.name.replace(/^gsd-/, '').replace(/\.md$/, ''));
      }
    }
  }
  // OMP local: flat gsd-*.md files at commands/ level
  const flatCommandsDir = path.join(configDir, 'commands');
  if (fs.existsSync(flatCommandsDir)) {
    for (const file of fs.readdirSync(flatCommandsDir)) {
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        out.add(file.replace(/^gsd-/, '').replace(/\.md$/, ''));
      }
    }
  }
  return out;
}

module.exports = {
  INSTALL_SCRIPT,
  MANIFEST_NAME,
  RUNTIME_META,
  stripAnsi,
  walk,
  installerEnv,
  runMinimalInstall,
  manifestSkillSet,
  manifestAgentCount,
  collectSkillBasenamesOnDisk,
};
