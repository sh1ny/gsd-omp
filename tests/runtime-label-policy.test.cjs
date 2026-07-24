'use strict';
/**
 * getRuntimeLabel is the SINGLE source of truth for the short install/uninstall
 * console display label, replacing the two duplicated `runtimeLabel` assignment
 * chains that previously lived in bin/install.js (uninstall() and install()) —
 * the add-a-host tax ADR-1239 Phase B (#1679) eliminates.
 *
 * OMP-only fork (F1 capability pruning): the curated label table is now
 * `{ omp: 'Oh My Pi' }` — every registry runtime except 'omp' is removed. The
 * test contracts below reflect that: the fallback is "Oh My Pi" (not
 * "Claude Code"), and the per-runtime new-project override table is empty
 * (every remaining runtime uses the default /gsd-new-project command).
 *
 * Adding a runtime descriptor requires adding its label to RUNTIME_LABELS (the
 * deliberate curation step); it does NOT require editing a count or golden
 * snapshot here.
 *
 * Voice: these SHORT UI labels are intentionally distinct from the descriptor
 * `title` (the long product name).
 *
 * ADR-1239 Phase B (#1679). Behavioral tests only: assert on returned values.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtimeNamePolicy = require('../gsd-core/bin/lib/runtime-name-policy.cjs');
const registry = require('../gsd-core/bin/lib/capability-registry.cjs');

const { getRuntimeLabel, getRuntimeNewProjectCommand, RUNTIME_LABELS } = runtimeNamePolicy;

const FALLBACK = 'Oh My Pi';
const RUNTIME_IDS = Object.keys(registry.runtimes);

test('getRuntimeLabel: every registry runtime resolves to a non-empty curated label (coverage contract, count-agnostic)', () => {
  assert.ok(RUNTIME_IDS.length > 0, 'registry must contain at least one runtime');
  for (const id of RUNTIME_IDS) {
    const label = getRuntimeLabel(id);
    assert.strictEqual(typeof label, 'string', `getRuntimeLabel('${id}') must be a string`);
    assert.ok(label.length > 0, `getRuntimeLabel('${id}') must be non-empty`);
  }
});

test('getRuntimeLabel drift guard: every registry runtime has an explicit RUNTIME_LABELS entry (forces a deliberate label per runtime)', () => {
  // Every registry runtime must have an explicit entry in RUNTIME_LABELS —
  // otherwise it silently falls through to the fallback. (In the OMP-only
  // fork the only registry runtime is 'omp' with label "Oh My Pi" which is
  // identical to the fallback; the test still enforces the explicit-entry
test('getRuntimeLabel drift guard: no registry runtime except omp falls through to the default (forces a deliberate label per runtime)', () => {
  // omp's curated label IS the fallback string "Oh My Pi" (just as claude's
  // curated "Claude Code" was the pre-F1 fallback), so it is exempt. Every
  // other registry runtime must resolve to a DISTINCT label — otherwise it was
  // added without a RUNTIME_LABELS entry and is silently masking as "Oh My Pi".
  for (const id of RUNTIME_IDS) {
    if (id === 'omp') continue;
    assert.notStrictEqual(
      getRuntimeLabel(id),
      FALLBACK,
      `registry runtime '${id}' resolved to the fallback "${FALLBACK}" — add a distinct entry to RUNTIME_LABELS in src/runtime-name-policy.cts`);
  }
});
  assert.strictEqual(getRuntimeLabel('claude-code'), FALLBACK,
    'getRuntimeLabel("claude-code") must return the default (raw-id match only; aliases are not expanded)');
});

// ---------------------------------------------------------------------------
// getRuntimeNewProjectCommand (ADR-1239 Phase B / #1679 AC2) — the per-runtime
// /gsd-new-project invocation syntax for the post-install next-step message.
// ---------------------------------------------------------------------------

// CURATED override table — runtimes whose /gsd-new-project invocation differs
// from the default. OMP uses the default; the table is intentionally empty
// post-F1 (the previous codex/cursor/kimi entries were pruned with those
// runtimes). When a future non-default runtime is added, place its entry here.
const NEW_PROJECT_OVERRIDES = {};
const DEFAULT_CMD = '/gsd-new-project';

test('getRuntimeNewProjectCommand: each override runtime resolves to its curated command', () => {
  for (const [id, expected] of Object.entries(NEW_PROJECT_OVERRIDES)) {
    assert.strictEqual(getRuntimeNewProjectCommand(id), expected, `override ${id}`);
  }
});

test('getRuntimeNewProjectCommand: every registry runtime not in the override table resolves to the default (count-agnostic)', () => {
  for (const id of RUNTIME_IDS) {
    if (Object.prototype.hasOwnProperty.call(NEW_PROJECT_OVERRIDES, id)) continue;
    assert.strictEqual(getRuntimeNewProjectCommand(id), DEFAULT_CMD,
      `runtime '${id}' must return the default command (add to NEW_PROJECT_OVERRIDES if it needs a non-default form)`);
  }
});

test('getRuntimeNewProjectCommand: unknown / empty → default (fail-closed)', () => {
  assert.strictEqual(getRuntimeNewProjectCommand('unknown'), DEFAULT_CMD);
  assert.strictEqual(getRuntimeNewProjectCommand(''), DEFAULT_CMD);
});
