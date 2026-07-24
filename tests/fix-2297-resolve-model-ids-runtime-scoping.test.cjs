/**
 * Bug #2297 — `resolve_model_ids:"omit"` must be scoped to the ACTIVE runtime,
 * not applied blindly whenever it appears anywhere in the merged config.
 *
 * Root cause (pre-fix): the installer writes `resolve_model_ids:"omit"` into the
 * SHARED `~/.gsd/defaults.json` for every runtime that lacks native model
 * aliases (#1156). Because that file is machine-wide, installing a non-Claude
 * runtime (e.g. codex) on a box that also runs Claude poisoned Claude's
 * no-project resolution: Claude would see `resolve_model_ids:"omit"` in the
 * merged global defaults and return `''` instead of its tier aliases
 * (opus/sonnet/haiku), silently defeating Claude's adaptive tier distinction.
 *
 * Fix (`src/model-resolver.cts` `resolveModelInternal`): the `"omit"` branch
 * now returns `''` ONLY when either
 *   (a) the PROJECT's own `.planning/config.json` explicitly sets
 *       `resolve_model_ids:"omit"` (user intent — #2517 finding #4, unchanged), OR
 *   (b) the ACTIVE runtime genuinely lacks native model aliases.
 * A native-alias runtime (currently only `claude`) IGNORES an `"omit"` that
 * came solely from the shared global defaults and falls through to its tier
 * aliases. Active-runtime precedence: `process.env.GSD_RUNTIME` -> `config.runtime`
 * -> per-install `.gsd-runtime` marker (absent in this dev/test tree, so the
 * chain always bottoms out at `'claude'`) -> `'claude'` (all canonicalized).
 *
 * IMPORTANT (empirically verified — see dispatch report): the global-defaults
 * merge path in `config-loader.cjs` (branch D: "no .planning/ at all") is ONLY
 * exercised when the project directory has NO `.planning/` directory whatsoever.
 * The moment a `.planning/` directory exists — even with an empty or absent
 * `config.json` inside it — the loader takes a different branch that does NOT
 * merge `~/.gsd/defaults.json` for these fields at all. So Group A below
 * (which specifically exercises the global-defaults poisoning fix) uses BARE
 * `fs.mkdtempSync` project dirs with no `.planning/` subdirectory. Group A #4,
 * Group B, and Group C all need a real per-project config, so those DO create
 * `.planning/config.json`.
 */

'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveModelInternal,
  _setInstallRuntimeMarkerForTests,
  _resetInstallRuntimeMarkerCacheForTests,
} = require('../gsd-core/bin/lib/model-resolver.cjs');

// ─── HOME / GSD_HOME / GSD_RUNTIME isolation ────────────────────────────────
// config-loader.cjs reads global defaults from
// path.join(process.env.GSD_HOME || os.homedir(), '.gsd', 'defaults.json').
// Isolate both HOME and GSD_HOME to a fresh tmpdir per test (so a developer's
// real ~/.gsd/defaults.json never bleeds into assertions), and save/restore
// GSD_RUNTIME since several tests set it directly to drive the active-runtime
// chain (#2297's second precedence rung). Also save/restore GSD_WORKSTREAM and
// GSD_PROJECT (#2297 correctness-review hermeticity gap): planningDir() reads
// both directly from process.env when its ws/project params are omitted, so an
// ambient GSD_WORKSTREAM/GSD_PROJECT in a developer's shell could silently
// redirect projectExplicitlySetsOmit()'s config-file reads to the wrong layer.
let _origHome;
let _origUserProfile;
let _origGsdHome;
let _origGsdRuntime;
let _origGsdWorkstream;
let _origGsdProject;
let _isolatedHome;

function isolateHome() {
  _origHome = process.env.HOME;
  _origUserProfile = process.env.USERPROFILE;
  _origGsdHome = process.env.GSD_HOME;
  _origGsdRuntime = process.env.GSD_RUNTIME;
  _origGsdWorkstream = process.env.GSD_WORKSTREAM;
  _origGsdProject = process.env.GSD_PROJECT;
  _isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-2297-home-'));
  process.env.HOME = _isolatedHome;
  // Windows resolves the home dir from USERPROFILE, not HOME — set both so the
  // isolation holds cross-platform (local/require-userprofile-with-home).
  process.env.USERPROFILE = _isolatedHome;
  process.env.GSD_HOME = _isolatedHome;
  delete process.env.GSD_RUNTIME;
  delete process.env.GSD_WORKSTREAM;
  delete process.env.GSD_PROJECT;
}

function restoreHome() {
  if (_origHome === undefined) delete process.env.HOME; else process.env.HOME = _origHome;
  if (_origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = _origUserProfile;
  if (_origGsdHome === undefined) delete process.env.GSD_HOME; else process.env.GSD_HOME = _origGsdHome;
  if (_origGsdRuntime === undefined) delete process.env.GSD_RUNTIME; else process.env.GSD_RUNTIME = _origGsdRuntime;
  if (_origGsdWorkstream === undefined) delete process.env.GSD_WORKSTREAM; else process.env.GSD_WORKSTREAM = _origGsdWorkstream;
  if (_origGsdProject === undefined) delete process.env.GSD_PROJECT; else process.env.GSD_PROJECT = _origGsdProject;
  rmDir(_isolatedHome);
  _isolatedHome = null;
}

function rmDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return;
  // eslint-disable-next-line local/no-raw-rmsync-in-tests -- carries the same maxRetries/retryDelay budget as helpers.cleanup; used for both the isolated-home and bare project temp dirs
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

function writeGlobalDefaults(obj) {
  fs.mkdirSync(path.join(_isolatedHome, '.gsd'), { recursive: true });
  fs.writeFileSync(path.join(_isolatedHome, '.gsd', 'defaults.json'), JSON.stringify(obj, null, 2));
}

// Bare project dir with NO .planning/ subdirectory — needed to exercise the
// config-loader's global-defaults merge branch (see file header).
function mkProjNoPlanning() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-2297-proj-noplan-'));
}

// Project dir WITH a .planning/config.json — the normal "inside a project" path.
function mkProjWithConfig(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-2297-proj-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(obj, null, 2));
  return dir;
}

// ─── Group A: GLOBAL-defaults "omit" is runtime-scoped (the #2297 fix) ─────
describe('#2297: global-defaults resolve_model_ids:"omit" is scoped to the active runtime', () => {
  let projDir;
  beforeEach(() => { isolateHome(); projDir = null; });
  afterEach(() => { rmDir(projDir); restoreHome(); });

  test('no runtime signal defaults to claude: executor and planner get distinct non-empty tier aliases (acceptance #3)', () => {
    // Global defaults poison the shared file with "omit" (simulating a
    // non-Claude runtime having been installed on this machine). With no
    // .planning/config.json (no project) and no GSD_RUNTIME, the active
    // runtime falls back to 'claude', which has native aliases and must
    // ignore the poisoned global "omit" — the adaptive tier distinction
    // between executor (sonnet) and planner (opus) must survive.
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();

    const executor = resolveModelInternal(projDir, 'gsd-executor');
    const planner = resolveModelInternal(projDir, 'gsd-planner');

    assert.strictEqual(executor, 'sonnet');
    assert.strictEqual(planner, 'opus');
    assert.notStrictEqual(executor, '');
    assert.notStrictEqual(planner, '');
    assert.notStrictEqual(executor, planner);
  });

  test('GSD_RUNTIME="claude" explicitly: executor still resolves to "sonnet" (claude ignores global omit)', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    process.env.GSD_RUNTIME = 'claude';

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), 'sonnet');
  });

  test('GSD_RUNTIME="codex": a non-alias runtime still honors the global omit (acceptance #4)', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    process.env.GSD_RUNTIME = 'codex';

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), '');
  });

  // #2297 correctness-review BLOCKER: resolveActiveRuntime() must canonicalize
  // its candidates via resolveRuntimeNameFromCandidates before checking
  // RUNTIMES_WITH_NATIVE_ALIASES, or an alias/case variant of "claude" would
  // fail the Set('claude').has() check and wrongly fall through to honoring the
  // poisoned global omit. These would FAIL against a non-canonicalizing resolver.
  test('GSD_RUNTIME="claude-code" (alias, not canonical "claude"): executor and planner still ignore the global omit', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    process.env.GSD_RUNTIME = 'claude-code';

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), 'sonnet');
    assert.strictEqual(resolveModelInternal(projDir, 'gsd-planner'), 'opus');
  });

  test('GSD_RUNTIME="Claude" (case variant): executor still resolves to "sonnet" (canonicalization is case-insensitive)', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    process.env.GSD_RUNTIME = 'Claude';

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), 'sonnet');
  });


  test('install-order independence (acceptance #1/#2): a global omit poisoned by a prior non-Claude install does not affect Claude resolution, and Claude retains its adaptive tier distinction', () => {
    // Resolution depends on the RESOLVING runtime (active runtime at call
    // time), not on install order — installing codex (or any non-alias
    // runtime) before/after Claude must never change what Claude itself
    // resolves to. Global omit present, no project, no runtime signal ->
    // default 'claude' -> tier aliases survive. Distinct from the first Group A
    // test above: this asserts install-order independence AND, specifically,
    // that executor/planner remain DIFFERENT tiers under the poisoned global
    // omit — i.e. install order never collapses Claude's adaptive tier
    // distinction into a single omitted value.
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();

    const executor = resolveModelInternal(projDir, 'gsd-executor');
    const planner = resolveModelInternal(projDir, 'gsd-planner');

    assert.strictEqual(executor, 'sonnet');
    assert.strictEqual(planner, 'opus');
    assert.notStrictEqual(executor, planner, 'install-order poisoning must not collapse the adaptive tier distinction');
  });
});

// ─── Group B: explicit PROJECT "omit" is still honored for EVERY runtime ───
// (#2517 finding #4 — preserved, NOT changed by #2297.)
describe('#2297: explicit project-level resolve_model_ids:"omit" is honored regardless of runtime', () => {
  let projDir;
  beforeEach(() => { isolateHome(); projDir = null; });
  afterEach(() => { rmDir(projDir); restoreHome(); });

  test('no runtime set, explicit project omit -> "" even though the default runtime is claude', () => {
    projDir = mkProjWithConfig({ resolve_model_ids: 'omit' });

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-planner'), '');
  });

  test('runtime:"claude" + explicit project omit -> "" (mirrors #2517 finding #4)', () => {
    projDir = mkProjWithConfig({ runtime: 'claude', resolve_model_ids: 'omit' });

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-planner'), '');
  });
});

// ─── Group B2: projectExplicitlySetsOmit is workstream-scope aware (#2297) ──
// The root .planning/config.json does NOT set resolve_model_ids, but the
// ACTIVE workstream's own config.json does — projectExplicitlySetsOmit()
// resolves via planningDir(cwd) (workstream layer wins over root, mirroring
// loadConfig's precedence), so the workstream's explicit "omit" must still be
// honored even though no global default and the default runtime (claude) would
// otherwise have returned a tier alias.
describe('#2297: explicit project-level "omit" is honored at the active-workstream config layer', () => {
  let projDir;
  let _origGsdWorkstreamForBlock;
  beforeEach(() => {
    isolateHome(); // clears GSD_WORKSTREAM/GSD_PROJECT as part of hermeticity
    projDir = null;
    _origGsdWorkstreamForBlock = process.env.GSD_WORKSTREAM;
  });
  afterEach(() => {
    if (_origGsdWorkstreamForBlock === undefined) delete process.env.GSD_WORKSTREAM;
    else process.env.GSD_WORKSTREAM = _origGsdWorkstreamForBlock;
    rmDir(projDir);
    restoreHome();
  });

  test('root config has no resolve_model_ids, but the active workstream config sets "omit" -> "" despite default runtime claude', () => {
    const ws = 'ws-alpha';
    projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-2297-proj-ws-'));
    fs.mkdirSync(path.join(projDir, '.planning'), { recursive: true });
    // Root config exists but does NOT set resolve_model_ids at all.
    fs.writeFileSync(
      path.join(projDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' }, null, 2)
    );
    // The active workstream's own config explicitly sets "omit".
    const wsConfigDir = path.join(projDir, '.planning', 'workstreams', ws);
    fs.mkdirSync(wsConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsConfigDir, 'config.json'),
      JSON.stringify({ resolve_model_ids: 'omit' }, null, 2)
    );
    process.env.GSD_WORKSTREAM = ws;

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-planner'), '');
  });
});


// ─── Group F: the install-marker precedence rung, driven directly (#2297) ──
// Previously untested: with no GSD_RUNTIME and no project config.runtime, the
// active runtime falls all the way through to the per-install .gsd-runtime
// marker (third precedence rung). The dev/source tree has no real marker file,
// so these tests drive that rung directly via the _setInstallRuntimeMarkerForTests
// / _resetInstallRuntimeMarkerCacheForTests seams exported specifically for this
// purpose (#2297 correctness-review gap).
describe('#2297: install-marker precedence rung (GSD_RUNTIME and config.runtime both absent)', () => {
  let projDir;
  beforeEach(() => {
    isolateHome(); // also deletes GSD_RUNTIME
    projDir = null;
    // Belt-and-suspenders: the marker rung is only reached when GSD_RUNTIME and
    // config.runtime are both absent; isolateHome() already deletes GSD_RUNTIME.
    delete process.env.GSD_RUNTIME;
  });
  afterEach(() => {
    rmDir(projDir);
    restoreHome();
    // CRITICAL: reset the module-level marker cache after every case in this
    // block so a set value never leaks into a later case here, or into any
    // OTHER describe block in this file (readInstallRuntimeMarker() otherwise
    // memoizes the first value it sees for the lifetime of the process).
    _resetInstallRuntimeMarkerCacheForTests();
  });

  test('marker="codex" (non-alias runtime): honors the poisoned global omit -> ""', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    _setInstallRuntimeMarkerForTests('codex');

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), '');
  });

  test('marker="claude": ignores the poisoned global omit -> "sonnet"', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    _setInstallRuntimeMarkerForTests('claude');

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), 'sonnet');
  });

  test('marker="claude-code" (alias): canonicalized to "claude" and still ignores the poisoned global omit -> "sonnet"', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    _setInstallRuntimeMarkerForTests('claude-code');

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), 'sonnet');
  });

  test('marker unset (null): falls through to the "claude" default and ignores the poisoned global omit -> "sonnet"', () => {
    writeGlobalDefaults({ resolve_model_ids: 'omit' });
    projDir = mkProjNoPlanning();
    _setInstallRuntimeMarkerForTests(null);

    assert.strictEqual(resolveModelInternal(projDir, 'gsd-executor'), 'sonnet');
  });
});
