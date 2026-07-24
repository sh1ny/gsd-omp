'use strict';

/**
 * Regression guards for shipped prompt references to gsd-tools.cjs.
 *
 * The original suite asserted on a runtime-aware slash formatter that emitted
 * per-runtime forms (`/gsd-<cmd>` for Claude-family, `$gsd-<cmd>` for Codex).
 * With omp as the only supported runtime, the formatter collapses to a single
 * form and the runtime-resolution table is gone. These tests are kept as a
 * regression-bucket stub: the prompt-content guards (no removed SDK references)
 * still apply, and the formatter contract is pinned to a single omp form.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'gsd');
const AGENTS_DIR = path.join(__dirname, '..', 'agents');

function mdFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(dir, f));
}

function rel(file) {
  return path.relative(path.join(__dirname, '..'), file);
}

const ROOT = path.resolve(__dirname, '..');
const { formatGsdSlash, resolveRuntime } = require(
  path.join(ROOT, 'gsd-core', 'bin', 'lib', 'runtime-slash.cjs'),
);

describe('command files: gsd-tools path references (#1766)', () => {
  test('shipped agents and commands do not instruct removed SDK query binaries', () => {
    const files = [...mdFiles(COMMANDS_DIR), ...mdFiles(AGENTS_DIR)];
    const violations = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (/\bgsd-sdk\s+query\b|\$GSD_SDK\s+query/.test(lines[i])) {
          violations.push(`${rel(file)}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    assert.strictEqual(violations.length, 0,
      'Shipped agent/command prompts must use gsd-tools query, not removed SDK query forms.\n' +
      'Violations:\n' + violations.join('\n'));
  });
});

describe('runtime-slash formatter — single omp form', () => {
  test('emits /gsd-<cmd> for omp', () => {
    assert.strictEqual(formatGsdSlash('execute-phase', 'omp'), '/gsd-execute-phase');
  });

  test('emits /gsd-<cmd> for omp and preserves command token casing', () => {
    assert.strictEqual(formatGsdSlash('Plan-Phase', 'omp'), '/gsd-Plan-Phase');
  });

  test('resolveRuntime returns a string when no env/config is set', () => {
    // resolveRuntime must not throw; the original runtime-resolution table is
    // gone, so this is just a smoke test that the API still exists.
    const prev = process.env.GSD_RUNTIME;
    delete process.env.GSD_RUNTIME;
    try {
      const result = resolveRuntime(process.cwd());
      assert.strictEqual(typeof result, 'string');
    } finally {
      if (prev !== undefined) process.env.GSD_RUNTIME = prev;
    }
  });
});
