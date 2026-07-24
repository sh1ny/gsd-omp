/**
 * Tests for the Windows npm resolution platform gate.
 *
 * Background (issue #3103, PR #3102):
 *   On Windows, `npm` ships as `npm.cmd`. Node's spawn does not apply PATHEXT
 *   resolution and fails with ENOENT. The fix is to spawn through a shell on
 *   Windows (cmd.exe resolves npm.cmd via PATHEXT). On POSIX, `npm` resolves
 *   without a shell, so spawning `/bin/sh -c` is pure overhead and changes
 *   signal / exit-code semantics — undesirable.
 *
 * Relocation (#498): the SessionStart worker no longer spawns npm itself. It
 * delegates the latest-version lookup to check-latest-version's
 * `checkLatestVersion()`, which routes through `execNpm` in the shell-command
 * projection seam. The PR #3102 contract therefore now lives on `execNpm`.
 * This test locks it there, and additionally locks that the worker does NOT
 * re-introduce a direct npm spawn (which would re-open the gate question in a
 * second place).
 *
 * Source-grep policy: these structural assertions read source via readFileSync.
 * The behavior (Windows-only shell resolution) is platform-gated at runtime and
 * cannot be reached on POSIX CI without a Windows lane; a structural assertion
 * is the minimum-cost contract.
 */

// allow-test-rule: structural assertion on spawn-options shape; the behavior
// (Windows-only shell resolution) is platform-gated at runtime and cannot be
// reached on POSIX CI without a Windows lane.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKER_PATH = path.join(__dirname, '..', 'hooks', 'gsd-check-update-worker.js');
const PROJECTION_PATH = path.join(
  __dirname, '..', 'gsd-core', 'bin', 'lib', 'shell-command-projection.cjs',
);

function codeOnly(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
}

describe('execNpm: Windows npm spawn platform gate (PR #3102, relocated #498)', () => {
  test('projection seam exists', () => {
    assert.ok(fs.existsSync(PROJECTION_PATH), `not found at ${PROJECTION_PATH}`);
  });

  test('execNpm gates shell to process.platform === "win32"', () => {
    assert.match(
      codeOnly(PROJECTION_PATH),
      /shell:\s*process\.platform\s*===\s*['"]win32['"]/,
      [
        'execNpm must gate shell to `process.platform === "win32"`.',
        'A regression to `shell: true` would spawn /bin/sh -c on POSIX',
        '(adds shell overhead, changes signal/exit semantics). See PR #3102.',
      ].join(' '),
    );
  });

  test('no unconditional shell: true on the npm spawn', () => {
    assert.doesNotMatch(
      codeOnly(PROJECTION_PATH),
      /shell\s*:\s*true\s*[,\s}]/,
      'shell: true is forbidden — use the `process.platform === "win32"` gate.',
    );
  });
});



// ────────────────────────────────────────────────────────────────────────
// Folded from tests/bug-2992-check-latest-version.test.cjs — consolidation epic #1969 (B5 #1974)
// ────────────────────────────────────────────────────────────────────────
{
  const { describe: __foldDescribe } = require('node:test');
  __foldDescribe("folded:bug-2992-check-latest-version (consolidation epic #1969 B5 #1974)", () => {
'use strict';
process.env.GSD_TEST_MODE = '1';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { checkLatestVersion, CHECK_REASON, PACKAGE_NAME } = require(
  path.join(ROOT, 'gsd-core', 'bin', 'check-latest-version.cjs'),
);

// checkLatestVersion is a pure-ish function: it spawns one fixed npm
// command, validates the output, and returns { ok, version | reason }.
// The package name is HARDCODED — not a free choice for the caller.
// Tests use a pluggable spawn so no real npm process is invoked.

describe('Bug #2992: deterministic latest-version check', () => {
  test('PACKAGE_NAME is the constant @opengsd/gsd-core (no callers can override)', () => {
    assert.equal(PACKAGE_NAME, '@opengsd/gsd-core');
  });

  test('CHECK_REASON enum exposes the documented codes', () => {
    assert.deepEqual(
      Object.keys(CHECK_REASON).sort(),
      ['FAIL_INVALID_OUTPUT', 'FAIL_NPM_FAILED', 'OK'].sort(),
    );
  });

  test('returns { ok: true, version } when npm prints a valid semver', () => {
    const fakeSpawn = () => ({ status: 0, stdout: '1.39.1\n', stderr: '' });
    const r = checkLatestVersion({ spawn: fakeSpawn });
    assert.deepEqual(r, { ok: true, version: '1.39.1', reason: CHECK_REASON.OK });
  });
});

describe('Bug #2992: error paths', () => {
  const { checkLatestVersion, CHECK_REASON } = require(require('node:path').join(__dirname, '..', 'gsd-core', 'bin', 'check-latest-version.cjs'));

  test('FAIL_NPM_FAILED when npm exits non-zero (e.g. offline, 404)', () => {
    const r = checkLatestVersion({
      spawn: () => ({ status: 1, stdout: '', stderr: 'npm ERR! 404\n' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, CHECK_REASON.FAIL_NPM_FAILED);
    assert.equal(r.detail, 'npm ERR! 404',
      'detail should be the trimmed stderr when npm reports a real error');
  });

  // #2993 CR: distinguish timeout from genuine npm failure in `detail`.
  // spawnSync sets status=null and signal='SIGTERM' on timeout; stderr is
  // typically empty. Without the signal-first branch, both shape as
  // 'npm exited non-zero' and the operator cannot tell timeout from failure.
  test('FAIL_NPM_FAILED detail names the signal when spawn times out', () => {
    const r = checkLatestVersion({
      spawn: () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, CHECK_REASON.FAIL_NPM_FAILED);
    assert.equal(r.detail, 'npm timed out (signal: SIGTERM)',
      'detail should explicitly name the signal when status is null and signal is set');
  });

  test('FAIL_NPM_FAILED detail falls back to generic when neither stderr nor signal is present', () => {
    const r = checkLatestVersion({
      spawn: () => ({ status: 1, stdout: '', stderr: '' }),
    });
    assert.equal(r.detail, 'npm exited non-zero');
  });

  test('FAIL_INVALID_OUTPUT when npm prints something that is not a semver', () => {
    // E.g. if a future npm version changes the output format, or if the
    // network returns an HTML error page captured as stdout.
    const r = checkLatestVersion({
      spawn: () => ({ status: 0, stdout: '<html>not a version</html>\n', stderr: '' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, CHECK_REASON.FAIL_INVALID_OUTPUT);
  });

  test('FAIL_INVALID_OUTPUT when stdout is empty', () => {
    const r = checkLatestVersion({
      spawn: () => ({ status: 0, stdout: '', stderr: '' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, CHECK_REASON.FAIL_INVALID_OUTPUT);
  });

  test('accepts pre-release semver (e.g. 1.40.0-rc.1)', () => {
    const r = checkLatestVersion({
      spawn: () => ({ status: 0, stdout: '1.40.0-rc.1\n', stderr: '' }),
    });
    assert.deepEqual(r, { ok: true, version: '1.40.0-rc.1', reason: CHECK_REASON.OK });
  });
});

describe('Issue #815: --next dist-tag support', () => {
  const { buildViewArgs, resolveTag, ALLOWED_TAGS } = require(
    path.join(ROOT, 'gsd-core', 'bin', 'check-latest-version.cjs'),
  );

  test('ALLOWED_TAGS is the sanctioned channel allowlist (latest, next)', () => {
    assert.deepEqual([...ALLOWED_TAGS].sort(), ['latest', 'next']);
  });

  test('buildViewArgs() defaults to the bare latest spec (byte-for-byte unchanged)', () => {
    assert.deepEqual(buildViewArgs(), ['view', '@opengsd/gsd-core', 'version']);
    assert.deepEqual(buildViewArgs('latest'), ['view', '@opengsd/gsd-core', 'version']);
  });

  test('buildViewArgs("next") targets the @next dist-tag', () => {
    assert.deepEqual(buildViewArgs('next'), ['view', '@opengsd/gsd-core@next', 'version']);
  });

  test('resolveTag defaults to latest when no --tag flag', () => {
    assert.equal(resolveTag(['--json']), 'latest');
  });

  test('resolveTag reads --tag next', () => {
    assert.equal(resolveTag(['--json', '--tag', 'next']), 'next');
  });

  test('resolveTag rejects an unknown tag (typo guard)', () => {
    assert.throws(() => resolveTag(['--tag', 'nightly']), /invalid --tag 'nightly'/);
  });

  test('resolveTag rejects --tag with no value', () => {
    assert.throws(() => resolveTag(['--tag']), /invalid --tag ''/);
  });

  test('checkLatestVersion accepts an RC under the next tag', () => {
    const r = checkLatestVersion({ tag: 'next', spawn: () => ({ status: 0, stdout: '1.4.0-rc.1\n', stderr: '' }) });
    assert.deepEqual(r, { ok: true, version: '1.4.0-rc.1', reason: CHECK_REASON.OK });
  });

  test('buildViewArgs rejects a tag outside the allowlist (exported-API guard)', () => {
    assert.throws(() => buildViewArgs('nightly'), /invalid dist-tag 'nightly'/);
  });

  test('checkLatestVersion rejects an out-of-allowlist tag even with an injected spawn', () => {
    assert.throws(
      () => checkLatestVersion({ tag: 'nightly', spawn: () => ({ status: 0, stdout: '9.9.9\n', stderr: '' }) }),
      /invalid dist-tag 'nightly'/,
    );
  });

  test('resolveTag handles the --tag=next equals form', () => {
    assert.equal(resolveTag(['--json', '--tag=next']), 'next');
  });

  test('resolveTag rejects an unknown --tag=value equals form (no silent fallback)', () => {
    assert.throws(() => resolveTag(['--tag=nightly']), /invalid --tag 'nightly'/);
  });
});
  });
}


// ────────────────────────────────────────────────────────────────────────
// Folded from tests/bug-378-update-check-scoped-name.test.cjs — consolidation epic #1969 (B5 #1974)
// ────────────────────────────────────────────────────────────────────────
{
  const { describe: __foldDescribe } = require('node:test');
  __foldDescribe("folded:bug-378-update-check-scoped-name (consolidation epic #1969 B5 #1974)", () => {
/**
 * Regression test for #378 / #498: the SessionStart update worker must end up
 * querying the SCOPED package name (@opengsd/gsd-core) when it asks
 * npm for the latest version.
 *
 * Background (#378): the worker once hardcoded the unscoped 'gsd-core',
 * which 404s from the registry, leaving update_available permanently false.
 *
 * Original #378 fix derived the name from `require('../package.json').name`.
 * That is broken at runtime (#498): the installed tree carries only a synthetic
 * `{"type":"commonjs"}` package.json (no `.name`), so post-install the worker
 * queried `npm view undefined version` → latest stayed null → update_available
 * permanently false. The old structural test passed only because it grepped the
 * DEV tree, where package.json still has a name.
 *
 * New contract (#498): the worker no longer resolves the package name itself.
 * It delegates the latest-version lookup to check-latest-version.cjs's
 * `checkLatestVersion()`, whose `PACKAGE_NAME` is sourced from the baked Package
 * Identity seam (`gsd-core/bin/lib/package-identity.cjs`). The seam's value
 * is a build-time constant, correct in every install layout, so the
 * undefined-at-runtime failure cannot recur. This test locks that contract:
 *
 *   1. Structural: worker must NOT contain the bare unscoped literal.
 *   2. Structural: worker must NOT use `require(...package.json...).name`
 *      (the runtime-broken path).
 *   3. Structural: worker delegates to check-latest-version's
 *      `checkLatestVersion` rather than calling `npm view` itself.
 *   4. Single-source: check-latest-version's PACKAGE_NAME === the seam's
 *      packageName === the scoped '@opengsd/gsd-core'.
 *
 * Source-grep policy: this test reads hook source via readFileSync. The repo's
 * lint-no-source-grep rule targets bin/lib/gsd-core — hooks/ is out of
 * scope. The behavior (correct name → no E404) only manifests at runtime
 * against the live registry; structural assertions are the minimum-cost
 * contract for the worker, the same rationale #378 carried.
 */

// allow-test-rule: structural assertion on hook delegation; the behavior being (see #378)
// tested (correct package name → no E404) only manifests at runtime against the
// live npm registry, which CI does not call.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKER_PATH = path.join(__dirname, '..', 'hooks', 'gsd-check-update-worker.js');
const PKG_PATH = path.join(__dirname, '..', 'package.json');
const SEAM = require('../gsd-core/bin/lib/package-identity.cjs');
const { PACKAGE_NAME } = require('../gsd-core/bin/check-latest-version.cjs');

function workerCodeOnly() {
  const src = fs.readFileSync(WORKER_PATH, 'utf8');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
}

  });
}


// ────────────────────────────────────────────────────────────────────────
// Folded from tests/bug-2784-update-cache-clear-path.test.cjs — consolidation epic #1969 (B5 #1974)
// ────────────────────────────────────────────────────────────────────────
{
  const { describe: __foldDescribe } = require('node:test');
  __foldDescribe("folded:bug-2784-update-cache-clear-path (consolidation epic #1969 B5 #1974)", () => {
// allow-test-rule: structural-regression-guard (see #2784)
// Reads hook .js or bin/install.js source to assert structural invariants
// (search array order, function wiring, path constants) that cannot be
// verified by observing runtime outputs alone. Per CONTRIBUTING.md exception matrix.

/**
 * Regression test for bug #2784
 *
 * /gsd-update cache-clear step only cleared per-runtime cache paths
 * (e.g. ~/.claude/cache/gsd-update-check.json) but the SessionStart hook
 * (hooks/gsd-check-update.js) writes to the shared tool-agnostic path
 * ~/.cache/gsd/gsd-update-check.json. After a successful update, the statusline
 * kept showing the stale "⬆ /gsd-update" indicator because the actual cache
 * file was never deleted.
 *
 * Fix: add `rm -f "$HOME/.cache/gsd/gsd-update-check.json"` to the
 * run_update step's cache-clear block in gsd-core/workflows/update.md.
 */

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const UPDATE_WORKFLOW = path.join(
  REPO_ROOT,
  'gsd-core',
  'workflows',
  'update.md'
);
const CHECK_UPDATE_HOOK = path.join(REPO_ROOT, 'hooks', 'gsd-check-update.js');

describe('bug-2784: update.md cache-clear covers shared cache path', () => {

  test('update.md run_update bash commands include rm for shared gsd cache file', () => {
    const workflowContent = fs.readFileSync(UPDATE_WORKFLOW, 'utf-8');
    // Parse the step block structurally, then extract only bash fenced code lines.
    const stepMatch = workflowContent.match(/<step name="run_update">[\s\S]*?<\/step>/);
    assert.ok(stepMatch, 'update.md must have a <step name="run_update"> block');
    const stepContent = stepMatch[0];

    const bashLines = [];
    const fenceRe = /```(?:bash|sh)\r?\n([\s\S]*?)```/g;
    let m;
    while ((m = fenceRe.exec(stepContent)) !== null) {
      for (const line of m[1].split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) bashLines.push(trimmed);
      }
    }

    const sharedCacheClearCmds = bashLines.filter(
      (line) => /^rm\b/.test(line) && line.includes('.cache/gsd/gsd-update-check') && line.includes('*.json')
    );
    assert.ok(
      sharedCacheClearCmds.length > 0,
      [
        'run_update step bash blocks must include an `rm` command targeting .cache/gsd/gsd-update-check*.json (glob form clearing legacy + per-package variants).',
        `Bash lines found: ${JSON.stringify(bashLines)}`,
      ].join('\n')
    );
    const hasHomeExpansion = sharedCacheClearCmds.some(
      (line) => line.includes('$HOME') || line.includes('~/')
    );
    assert.ok(
      hasHomeExpansion,
      `shared cache rm command must use $HOME or ~/ expansion; found: ${JSON.stringify(sharedCacheClearCmds)}`
    );
  });
});
  });
}

