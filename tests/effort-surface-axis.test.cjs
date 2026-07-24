// allow-test-rule: source-text-is-the-product (see #2481)
// The original test file asserted on per-runtime renderEffortArgv (claude, codex,
// opencode) and on shipped descriptors for removed runtimes (vscode,
// etc.). With omp as the only supported runtime, those axes no longer exist:
//   - renderEffortArgv('omp', …) returns { argv: [], value: null, host: 'omp' }
//   - shipped descriptors for removed runtimes are gone
//   - the gsd-tools CLI no longer exposes --host / --attempt flags
// The behavioral assertions in this file are therefore obsolete and have been
// replaced with a stub that pins the new contract.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const {
  renderEffortArgv,
} = require(path.join(REPO_ROOT, 'gsd-core', 'bin', 'lib', 'model-catalog.cjs'));

describe('#2481 effortSurface — folded into the single omp runtime', () => {
  test('renderEffortArgv(omp, …) returns an empty argv envelope (no per-host surface)', () => {
    const result = renderEffortArgv('omp', 'high', 'argv');
    assert.deepEqual(result, { argv: [], value: null, host: 'omp' });
  });

  test('renderEffortArgv returns the same shape for any level and surface', () => {
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      for (const surface of ['argv', 'none', 'undocumented']) {
        const r = renderEffortArgv('omp', level, surface);
        assert.deepEqual(r.argv, [], `expected empty argv for level=${level} surface=${surface}`);
        assert.strictEqual(r.value, null);
      }
    }
  });
});
