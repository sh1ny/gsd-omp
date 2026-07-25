#!/usr/bin/env node
// Bun/Node test orchestrator — resolves test file globs and dispatches to either
// `bun test` or `node --test`. Replaces run-tests.cjs, preserving its CLI flag
// grammar (--suite, --shard i/N, --files-from) to minimize CI churn.
//
// Suite filtering (issue #3597):
//   node scripts/test-suites.cjs                 # default — runs ALL tests (backcompat)
//   node scripts/test-suites.cjs --suite all     # explicit "everything"
//   node scripts/test-suites.cjs --suite unit    # only files with no other suite marker
//   node scripts/test-suites.cjs --suite security    # *.security.test.cjs
//   node scripts/test-suites.cjs --suite integration # *.integration.test.cjs
//   node scripts/test-suites.cjs --suite install     # *.install.test.cjs
//   node scripts/test-suites.cjs --suite slow        # *.slow.test.cjs
//   node scripts/test-suites.cjs --files "a.test.cjs b.test.cjs"
//   node scripts/test-suites.cjs --files-from /tmp/selected-tests.txt
//   node scripts/test-suites.cjs --suite unit --shard 1/3   # shard 1 of 3 (#1212)
//   node scripts/test-suites.cjs --runner bun    # force bun (default)
//   node scripts/test-suites.cjs --runner node   # force node --test
//
// Runner precedence: --runner flag > TEST_RUNNER env > bun (default).
//
// Sharding (issue #1212, reweighted #2472): --shard <i>/<n> runs a
// deterministic, COST-balanced slice of the SORTED selected file list. Files
// are partitioned by measured duration (tests/test-timings.json) using LPT.
// i is 1-based (1..n); n >= 1; n=1 is a pure no-op (all files). The CI full
// lane shards across N parallel runners. Sharding composes with --suite.
//
// Suite grouping convention: filename suffix marker before `.test.cjs`.
// A file named `foo.security.test.cjs` belongs to the `security` suite.
// A file named `foo.test.cjs` (no marker) belongs to the `unit` suite.
// See docs/TESTING-SUITES.md for full grouping policy.
'use strict';

const { readdirSync, readFileSync } = require('fs');
const { join, basename } = require('path');
const { execFileSync } = require('child_process');
const { ExitError, runMain } = require('./lib/cli-exit.cjs');

const SUITES = ['all', 'unit', 'integration', 'install', 'security', 'slow'];

const MARKED_SUITES = ['integration', 'install', 'security', 'slow'];

// Return the marked suite name embedded in a filename, or null if it's unmarked.
// foo.security.test.cjs -> "security"
// foo.test.cjs          -> null (unit)
// Accepts either a bare filename or a relative subdir path; classification is
// based on the basename only so subdir paths classify identically to root files.
function suiteOf(filename) {
  const name = basename(filename);
  if (!name.endsWith('.test.cjs')) return null;
  const base = name.slice(0, -'.test.cjs'.length);
  const lastDot = base.lastIndexOf('.');
  if (lastDot === -1) return null;
  const marker = base.slice(lastDot + 1);
  return MARKED_SUITES.includes(marker) ? marker : null;
}

// Recursively collect *.test.cjs files under dir, returning paths relative to dir.
// Skips node_modules to avoid accidentally picking up decoy files.
function walkTestFiles(dir, relBase) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      results.push(...walkTestFiles(join(dir, entry.name), relBase ? `${relBase}/${entry.name}` : entry.name));
    } else if (entry.name.endsWith('.test.cjs')) {
      results.push(relBase ? `${relBase}/${entry.name}` : entry.name);
    }
  }
  return results;
}

// Enumerate test files for a suite under root (default: repo tests/ dir).
// Returns repo-relative paths (relative to tests dir).
function listFiles(suite, root) {
  const testDir = root || join(__dirname, '..', 'tests');
  const allFiles = walkTestFiles(testDir, '').sort();
  if (suite === undefined || suite === null || suite === 'all') return allFiles;
  if (suite === 'unit') return allFiles.filter((f) => suiteOf(f) === null);
  return allFiles.filter((f) => suiteOf(f) === suite);
}

function selectFiles(allFiles, suite) {
  if (suite === null || suite === 'all') {
    return allFiles;
  }
  if (suite === 'unit') {
    return allFiles.filter((f) => suiteOf(f) === null);
  }
  return allFiles.filter((f) => suiteOf(f) === suite);
}

function splitFileList(value) {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.replace(/\\/g, '/')) // normalize Windows backslashes
    .map((v) => v.replace(/^tests\//, ''));
}

function selectExplicitFiles(allFiles, filesValue, filesFrom) {
  const fs = require('fs');
  const requested = filesFrom
    ? splitFileList(fs.readFileSync(filesFrom, 'utf8'))
    : splitFileList(filesValue);
  const available = new Set(allFiles);

  // Build a basename -> [relpath, ...] index for bare-basename resolution.
  const basenameIndex = new Map();
  for (const f of allFiles) {
    const b = basename(f);
    if (!basenameIndex.has(b)) basenameIndex.set(b, []);
    basenameIndex.get(b).push(f);
  }

  const selected = [];
  const missing = [];
  const errors = [];
  for (const file of requested) {
    // If the token is a bare suite name (e.g. "unit" written by ci-test-scope
    // as the #408 fallback sentinel), delegate to the existing suite resolver
    // rather than treating it as a filename. This prevents the
    // "requested test file(s) not found: unit" crash (#641).
    if (SUITES.includes(file)) {
      for (const f of selectFiles(allFiles, file)) {
        selected.push(f);
      }
    } else if (available.has(file)) {
      selected.push(file);
    } else if (!file.includes('/')) {
      const candidates = basenameIndex.get(file);
      if (!candidates || candidates.length === 0) {
        missing.push(file);
      } else if (candidates.length > 1) {
        errors.push(
          `ambiguous basename "${file}" matches multiple files: ${candidates.join(', ')} — pass the subdir path instead`,
        );
      } else {
        selected.push(candidates[0]);
      }
    } else {
      missing.push(file);
    }
  }
  if (errors.length > 0) {
    return { error: errors.join('; ') };
  }
  if (missing.length > 0) {
    return {
      error: `requested test file(s) not found: ${missing.join(', ')}`,
    };
  }
  return { files: [...new Set(selected)] };
}

// Parse a `--shard i/n` value into { index, total } or { error }.
function parseShardArg(value) {
  if (typeof value !== 'string') {
    return { error: `--shard requires a value of the form i/n` };
  }
  const m = /^(\d+)\/(\d+)$/.exec(value);
  if (!m) {
    return { error: `--shard value "${value}" must be of the form i/n (e.g. 1/3)` };
  }
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isInteger(total) || total < 1) {
    return { error: `--shard total n must be an integer >= 1, got "${m[2]}"` };
  }
  if (!Number.isInteger(index) || index < 1 || index > total) {
    return { error: `--shard index i must be an integer in 1..${total}, got "${m[1]}"` };
  }
  return { index, total };
}

// Deterministic partition of an ALREADY-SORTED file list (LPT cost-balanced).
// `total=1` returns the input unchanged (pure no-op). Without a weigher this is
// the original round-robin (#1212); with one it switches to equal-cost LPT.
function selectShard(sortedFiles, { index, total }, weightOf) {
  if (total === 1) return sortedFiles;
  if (typeof weightOf !== 'function') {
    return sortedFiles.filter((_, k) => k % total === index - 1);
  }
  const safeWeight = (file) => {
    const w = weightOf(file);
    return Number.isFinite(w) && w >= 0 ? w : 0;
  };
  const bins = Array.from({ length: total }, () => ({ weight: 0, picks: [] }));
  const order = sortedFiles
    .map((file, k) => ({ k, weight: safeWeight(file) }))
    .sort((a, b) => b.weight - a.weight || a.k - b.k);
  for (const entry of order) {
    let lightest = 0;
    for (let i = 1; i < total; i += 1) {
      const bin = bins[i];
      const best = bins[lightest];
      if (bin.weight < best.weight
        || (bin.weight === best.weight && bin.picks.length < best.picks.length)) {
        lightest = i;
      }
    }
    bins[lightest].weight += entry.weight;
    bins[lightest].picks.push(entry.k);
  }
  return bins[index - 1].picks.sort((a, b) => a - b).map((k) => sortedFiles[k]);
}

// Read an operator-supplied numeric env knob, falling back to the default for
// anything that is not a positive finite number.
function positiveNumberEnv(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Per-file measured durations, regenerated by scripts/gen-test-timings.cjs from
// gsd-test reporter event streams. Overridable so tests can inject a synthetic
// table instead of depending on the real suite's cost profile.
const DEFAULT_TIMINGS_PATH = join(__dirname, '..', 'tests', 'test-timings.json');
const SUPPORTED_TIMINGS_SCHEMA = 1;

function loadTestTimings(timingsPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(timingsPath, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.schema_version !== undefined && parsed.schema_version !== SUPPORTED_TIMINGS_SCHEMA) {
    return null;
  }
  const timings = parsed.timings;
  if (!timings || typeof timings !== 'object' || Array.isArray(timings)) return null;
  const values = Object.values(timings).filter(
    (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  );
  if (values.length === 0) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (!(mean > 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { timings, mean, medianWeight: median / mean };
}

function makeFileWeigher(timings) {
  if (!timings) return () => 1;
  return (f) => {
    const key = basename(f);
    const ms = Object.hasOwn(timings.timings, key) ? timings.timings[key] : undefined;
    return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0
      ? ms / timings.mean
      : timings.medianWeight;
  };
}

// Pack `files` into chunks using LPT (longest-processing-time-first).
// `maxChars` bounds each chunk's argv (Windows CreateProcess caps at 32,767).
function packChunks(files, { weightOf, maxWeight, maxChars, fixedOverhead }) {
  if (files.length === 0) return [];
  const weightBudget = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : files.length;
  const charBudget = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : Number.MAX_SAFE_INTEGER;
  const overhead = Number.isFinite(fixedOverhead) && fixedOverhead >= 0 ? fixedOverhead : 0;
  const safeWeight = (file) => {
    const w = weightOf(file);
    return Number.isFinite(w) && w >= 0 ? w : 0;
  };
  const entries = files.map((file, index) => ({
    file,
    index,
    weight: safeWeight(file),
    chars: file.length + 1,
  }));
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const sortKey = (f) => f.replace(/\\/g, '/');
  const heaviestFirst = [...entries].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const ka = sortKey(a.file);
    const kb = sortKey(b.file);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  let chunkCount = Math.min(
    files.length,
    Math.max(1, Math.ceil(totalWeight / weightBudget), Math.ceil(files.length / weightBudget)),
  );
  for (;;) {
    const bins = Array.from({ length: chunkCount }, () => ({
      entries: [],
      weight: 0,
      chars: overhead,
    }));
    let overflowed = false;
    for (const entry of heaviestFirst) {
      let target = null;
      for (const bin of bins) {
        if (bin.entries.length > 0 && bin.chars + entry.chars > charBudget) continue;
        if (target === null || bin.weight < target.weight) target = bin;
      }
      if (target === null) {
        overflowed = true;
        break;
      }
      target.entries.push(entry);
      target.weight += entry.weight;
      target.chars += entry.chars;
    }
    if (!overflowed) {
      return bins
        .filter((bin) => bin.entries.length > 0)
        .map((bin) => bin.entries.sort((a, b) => a.index - b.index).map((e) => e.file));
    }
    chunkCount++;
  }
}

function parseArgs(argv) {
  let suite = null;
  let seen = false;
  let files = null;
  let filesFrom = null;
  let shard = null;
  let shardSeen = false;
  let runner = null;
  let runnerSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shard' || a.startsWith('--shard=')) {
      if (shardSeen) {
        return { error: 'duplicate --shard flag' };
      }
      shardSeen = true;
      let v;
      if (a === '--shard') {
        v = argv[i + 1];
        if (v === undefined || (typeof v === 'string' && v.startsWith('--'))) {
          return { error: '--shard requires a value of the form i/n' };
        }
        i++;
      } else {
        v = a.slice('--shard='.length);
      }
      const parsed = parseShardArg(v);
      if (parsed.error) {
        return { error: parsed.error };
      }
      shard = parsed;
    } else if (a === '--suite') {
      if (seen) {
        return { error: 'duplicate --suite flag' };
      }
      seen = true;
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) {
        return { error: '--suite requires a value' };
      }
      suite = v;
      i++;
    } else if (a.startsWith('--suite=')) {
      if (seen) {
        return { error: 'duplicate --suite flag' };
      }
      seen = true;
      suite = a.slice('--suite='.length);
      if (!suite) {
        return { error: '--suite requires a value' };
      }
    } else if (a === '--runner' || a.startsWith('--runner=')) {
      if (runnerSeen) {
        return { error: 'duplicate --runner flag' };
      }
      runnerSeen = true;
      let v;
      if (a === '--runner') {
        v = argv[i + 1];
        if (!v || v.startsWith('--')) {
          return { error: '--runner requires a value (bun|node)' };
        }
        i++;
      } else {
        v = a.slice('--runner='.length);
      }
      if (v !== 'bun' && v !== 'node') {
        return { error: `--runner must be "bun" or "node", got "${v}"` };
      }
      runner = v;
    } else if (a === '--files') {
      if (files !== null) {
        return { error: 'duplicate --files flag' };
      }
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) {
        return { error: '--files requires a value' };
      }
      files = v;
      i++;
    } else if (a.startsWith('--files=')) {
      if (files !== null) {
        return { error: 'duplicate --files flag' };
      }
      files = a.slice('--files='.length);
      if (!files) {
        return { error: '--files requires a value' };
      }
    } else if (a === '--files-from') {
      if (filesFrom !== null) {
        return { error: 'duplicate --files-from flag' };
      }
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) {
        return { error: '--files-from requires a value' };
      }
      filesFrom = v;
      i++;
    } else if (a.startsWith('--files-from=')) {
      if (filesFrom !== null) {
        return { error: 'duplicate --files-from flag' };
      }
      filesFrom = a.slice('--files-from='.length);
      if (!filesFrom) {
        return { error: '--files-from requires a value' };
      }
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  if (files !== null && filesFrom !== null) {
    return { error: '--files and --files-from cannot be combined' };
  }
  return { suite, files, filesFrom, shard, runner };
}

// Resolve the runner: --runner flag > TEST_RUNNER env > 'bun'.
function resolveRunner(flagValue) {
  if (flagValue) return flagValue;
  const env = process.env.TEST_RUNNER;
  if (env === 'bun' || env === 'node') return env;
  return 'bun';
}

function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  if (parsed.error) {
    console.error(`test-suites: ${parsed.error}`);
    console.error(`Valid suites: ${SUITES.join(', ')}`);
    throw new ExitError(2);
  }
  const suite = parsed.suite;
  if (suite !== null && !SUITES.includes(suite)) {
    console.error(`test-suites: unknown suite "${suite}"`);
    console.error(`Valid suites: ${SUITES.join(', ')}`);
    throw new ExitError(2);
  }

  const testDir = process.env.GSD_TEST_DIR
    ? process.env.GSD_TEST_DIR
    : join(__dirname, '..', 'tests');

  const allFiles = walkTestFiles(testDir, '').sort();

  if (allFiles.length === 0) {
    console.error(`No test files found in ${testDir}`);
    throw new ExitError(1);
  }

  const usingExplicitFiles = parsed.files !== null || parsed.filesFrom !== null;
  let selectedNames;
  if (usingExplicitFiles) {
    const explicit = selectExplicitFiles(allFiles, parsed.files, parsed.filesFrom);
    if (explicit.error) {
      console.error(`test-suites: ${explicit.error}`);
      throw new ExitError(2);
    }
    selectedNames = explicit.files;
  } else {
    selectedNames = selectFiles(allFiles, suite);
  }

  // Shard partitioning (#1212): keep only this shard's deterministic
  // cost-balanced slice. Sort here so --shard is deterministic regardless of
  // how the selection was produced.
  let weigherMemo = null;
  const fileWeightOf = () => {
    if (weigherMemo === null) {
      const timingsPath = process.env.RUN_TESTS_TIMINGS_FILE || DEFAULT_TIMINGS_PATH;
      weigherMemo = makeFileWeigher(loadTestTimings(timingsPath));
    }
    return weigherMemo;
  };

  const usingShard = parsed.shard !== null;
  let emptyBeforeShard = false;
  let shardInput = null;
  if (usingShard) {
    emptyBeforeShard = selectedNames.length === 0;
    shardInput = [...selectedNames].sort();
    selectedNames = selectShard(shardInput, parsed.shard, fileWeightOf());
  }

  const selected = selectedNames.map((f) => join(testDir, f));

  if (selected.length === 0) {
    const legitimatelyEmptyShard = usingShard && !emptyBeforeShard;
    if (usingExplicitFiles || legitimatelyEmptyShard) {
      console.error(`test-suites: no tests in suite "${suite || 'all'}"`);
      return 0;
    }
    if (process.env.GSD_ALLOW_EMPTY_SUITE === '1') {
      console.error(`test-suites: WARNING: 0 test files selected for suite "${suite || 'all'}" — discovery or suite filter may be broken (GSD_ALLOW_EMPTY_SUITE=1 suppressed the error)`);
      return 0;
    }
    console.error(`test-suites: ERROR: 0 test files selected for suite "${suite || 'all'}" — discovery or suite filter is broken`);
    throw new ExitError(1);
  }

  // Hermeticity: strip env vars that would redirect fixture reads.
  delete process.env.GSD_PROJECT;
  delete process.env.GSD_WORKSTREAM;
  delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  {
    const { mkdtempSync } = require('fs');
    const { join: _join, basename: _basename } = require('path');
    const { tmpdir } = require('os');
    const _gh = process.env.GSD_HOME;
    if (!_gh || !_basename(_gh).startsWith('gsd-test-home-')) {
      process.env.GSD_HOME = mkdtempSync(_join(tmpdir(), 'gsd-test-home-'));
    }
  }

  const runner = resolveRunner(parsed.runner);

  console.error(
    `test-suites: suite="${suite || 'all'}" runner=${runner} files=${selected.length}: ${selected
      .map((f) => f.split(/[\\/]/).pop())
      .join(' ')}`,
  );

  if (usingShard) {
    const weigher = fileWeightOf();
    const table = loadTestTimings(process.env.RUN_TESTS_TIMINGS_FILE || DEFAULT_TIMINGS_PATH);
    const mine = selectedNames.map((f) => f.split(/[\\/]/).pop());
    const weighed = table
      ? mine.filter((n) => Object.hasOwn(table.timings, n)).length
      : 0;
    const myWeight = mine.reduce((sum, n) => sum + weigher(n), 0);
    let sig = 0;
    for (const n of shardInput.map((f) => f.split(/[\\/]/).pop())) {
      let h = 2166136261;
      for (let i = 0; i < n.length; i += 1) {
        h = Math.imul(h ^ n.charCodeAt(i), 16777619);
      }
      sig = (sig + (h >>> 0) + Math.round(weigher(n) * 1000)) % 0xffffffff;
    }
    console.error(
      `test-suites: shard=${parsed.shard.index}/${parsed.shard.total} `
      + `files=${mine.length}/${shardInput.length} weighed=${weighed} `
      + `weight=${myWeight.toFixed(2)} table=${table ? 'loaded' : 'absent'} `
      + `sig=${sig.toString(16)}`,
    );
  }

  // Concurrency: 4 on Linux/macOS, 2 on Windows. Operator override via
  // TEST_CONCURRENCY env var.
  const defaultConcurrency = process.platform === 'win32' ? 2 : 4;
  const concurrency = process.env.TEST_CONCURRENCY
    ? Number(process.env.TEST_CONCURRENCY)
    : defaultConcurrency;

  // Windows CreateProcess caps the full command line at 32,767 chars.
  const MAX_CMDLINE_CHARS = positiveNumberEnv(
    process.env.RUN_TESTS_MAX_CMDLINE_CHARS,
    28000,
  );
  const MAX_FILES_PER_CHUNK = positiveNumberEnv(process.env.RUN_TESTS_MAX_FILES_PER_CHUNK, 60);

  // Build runner command + per-runner flags.
  // Bun: `bun test [--max-concurrency N] <files...>`
  // Node: `node --test --test-force-exit [--test-concurrency N] <files...>`
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const forceExit = nodeMajor >= 22 && !process.env.RUN_TESTS_NO_FORCE_EXIT;

  // fixedOverhead for the argv byte budget. Each runner's fixed args differ.
  let runnerBin;
  let runnerFixedArgs;
  let fixedOverhead;
  if (runner === 'bun') {
    runnerBin = process.platform === 'win32' ? 'bun.exe' : 'bun';
    runnerFixedArgs = ['test'];
    if (Number.isFinite(concurrency) && concurrency > 0) {
      runnerFixedArgs.push('--max-concurrency', String(concurrency));
    }
    fixedOverhead = runnerBin.length + runnerFixedArgs.join(' ').length + 8;
  } else {
    runnerBin = process.execPath;
    runnerFixedArgs = ['--test'];
    const concurrencyFlag = `--test-concurrency=${concurrency}`;
    runnerFixedArgs.push(concurrencyFlag);
    if (forceExit) runnerFixedArgs.push('--test-force-exit');
    fixedOverhead = runnerBin.length + runnerFixedArgs.join(' ').length + 8;
  }

  const chunks = packChunks(selected, {
    weightOf: fileWeightOf(),
    maxWeight: MAX_FILES_PER_CHUNK,
    maxChars: MAX_CMDLINE_CHARS,
    fixedOverhead,
  });

  const chunkTimeoutMs = positiveNumberEnv(process.env.RUN_TESTS_CHUNK_TIMEOUT_MS, 600000);

  let firstFailureExit = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) {
      console.error(`test-suites: chunk ${i + 1}/${chunks.length} — ${chunks[i].length} files (${runner})`);
    }
    try {
      execFileSync(
        runnerBin,
        [...runnerFixedArgs, ...chunks[i]],
        {
          stdio: 'inherit',
          env: { ...process.env },
          timeout: chunkTimeoutMs,
        },
      );
    } catch (err) {
      // ENOENT: the runner binary is not on PATH. Surface a clear message.
      if (err.code === 'ENOENT' && err.path === runnerBin && runner === 'bun') {
        console.error(
          `test-suites: bun executable not found on PATH — install bun or re-run with --runner node`,
        );
        throw new ExitError(127);
      }
      const timedOut = err.killed === true || err.code === 'ETIMEDOUT';
      if (timedOut) {
        console.error(
          `test-suites: chunk ${i + 1}/${chunks.length} exceeded the per-chunk timeout ` +
            `of ${chunkTimeoutMs}ms and was killed. Two possible causes: (1) a test leaks ` +
            `an open handle so the runner never exits — but --test-force-exit (node) already ` +
            `guards that, so if it is enabled suspect (2) the chunk is legitimately too slow ` +
            `for the budget. Check whether output kept flowing until the kill (slow) vs ` +
            `stopped early (hang) before assuming a leak. Files: ${chunks[i]
              .map((f) => f.split(/[\\/]/).pop())
              .join(' ')}`,
        );
      }
      const code = err.status || 1;
      if (firstFailureExit === 0) firstFailureExit = code;
      if (timedOut) {
        const skipped = chunks.length - (i + 1);
        if (skipped > 0) {
          console.error(
            `test-suites: aborting — skipping the remaining ${skipped} chunk${skipped === 1 ? '' : 's'} ` +
              `after the chunk ${i + 1}/${chunks.length} timeout rather than risk the CI runner ` +
              `cancelling the job before they finish.`,
          );
        }
        break;
      }
    }
  }
  if (firstFailureExit !== 0) return firstFailureExit;
}

if (require.main === module) {
  runMain(main);
}

module.exports = {
  SUITES,
  suiteOf,
  listFiles,
  walkTestFiles,
  selectFiles,
  selectExplicitFiles,
  parseShardArg,
  selectShard,
  positiveNumberEnv,
  loadTestTimings,
  makeFileWeigher,
  packChunks,
  DEFAULT_TIMINGS_PATH,
};
