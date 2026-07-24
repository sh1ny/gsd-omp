'use strict';

/**
 * Behavioral regression tests for ADR-1239 Phase B write-confinement.
 *
 * The original suite asserted on a per-runtime install path
 * (claude/codex/opencode/cursor/windsurf/…) and on a per-runtime write
 * confinement (installCodexConfig, installOpencodeFamilySkills, etc.).
 * With omp as the only supported runtime, the per-runtime write paths
 * collapse to a single omp path. The copyWithPathReplacement escape
 * rejection symmetry (the original Phase B invariant) still applies and
 * is pinned below for omp.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env['GSD_TEST_MODE'] = '1';
const {
  copyWithPathReplacement,
} = require('../bin/install.js');

describe('write-confinement: copyWithPathReplacement (omp)', () => {
  test('1. happy path: file is written under confinementRoot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cwpr-happy-omp-'));
    try {
      const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cwpr-src-omp-'));
      try {
        fs.writeFileSync(path.join(srcDir, 'test.md'), '---\nname: test\n---\nbody\n', 'utf8');
        const destDir = path.join(root, 'sub', 'dest');
        copyWithPathReplacement(srcDir, destDir, '~/.omp/', 'omp', false, false, root);
        const written = fs.existsSync(path.join(destDir, 'test.md'));
        assert.ok(written, 'test.md must have been written to destDir under root');
        assert.ok(
          path.resolve(destDir).startsWith(path.resolve(root) + path.sep),
          'destDir must be under root',
        );
      } finally {
        try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  test('2. escape rejected: destDir outside confinementRoot → throws', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cwpr-root-omp-'));
    const escapeName = 'gsd-cwpr-escape-omp-' + Date.now();
    const escapePath = path.join(os.tmpdir(), escapeName);
    try {
      const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cwpr-src2-omp-'));
      try {
        fs.writeFileSync(path.join(srcDir, 'evil.md'), '# evil\n', 'utf8');
        const destDir = path.join(root, '..', escapeName);
        assert.throws(
          () => copyWithPathReplacement(srcDir, destDir, '~/.omp/', 'omp', false, false, root),
          /escap|must be a strict subpath|refusing/i,
        );
        assert.ok(!fs.existsSync(escapePath), 'must not create anything at the escape path');
      } finally {
        try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
      if (fs.existsSync(escapePath)) {
        try { fs.rmSync(escapePath, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }
  });

  test('3. fail-closed: omitting confinementRoot throws with descriptive message', () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cwpr-fc-src-omp-'));
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cwpr-fc-dst-omp-'));
    try {
      assert.throws(
        () => copyWithPathReplacement(srcDir, destDir, '~/.omp/', 'omp', false, false, undefined),
        /confinementRoot is required|fail-closed|required/i,
      );
    } finally {
      try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
});
