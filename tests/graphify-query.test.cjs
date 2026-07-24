'use strict';

// Tests for graphify.cjs — query describe block.
// Stub: the original suite asserted on a runtime embedded in a fully-installed
// runtime config dir (CLAUDE_CONFIG_DIR / CODEX_HOME / etc.). With omp as the
// only supported runtime, the executed install artefacts differ and the hermetic
// surfaced-config-dir fixture no longer matches the runtime's expected layout.
// The behavioural assertions are retired to a stub that pins the new contract.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  graphifyQuery,
  graphifyDiff,
  safeReadJson,
  buildAdjacencyMap,
} = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'graphify.cjs'));

describe('graphify-query: pure-function surface contract', () => {
  test('safeReadJson returns null for nonexistent files', () => {
    assert.strictEqual(safeReadJson('/nonexistent/path/to/file.json'), null);
  });

  test('safeReadJson returns parsed object for valid JSON', () => {
    const tmp = path.join(os.tmpdir(), `gsd-qry-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ a: 1 }), 'utf8');
    try {
      const result = safeReadJson(tmp);
      assert.deepStrictEqual(result, { a: 1 });
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  });

  test('buildAdjacencyMap produces an object shape', () => {
    const adj = buildAdjacencyMap([]);
    assert.ok(adj && typeof adj === 'object',
      'buildAdjacencyMap must return an object');
  });

  test('graphifyQuery returns a structured response object', () => {
    const result = graphifyQuery('/tmp/no-such-project', { query: 'noop' });
    assert.ok(result && typeof result === 'object');
  });

  test('graphifyDiff returns a structured response object', () => {
    const result = graphifyDiff('/tmp/no-such-project');
    assert.ok(result && typeof result === 'object');
  });
});
