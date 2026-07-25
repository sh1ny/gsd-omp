// Tests for scripts/test-suites.cjs — suite filtering, sharding, chunk packing,
// and files-from sentinel expansion. Ports the pure-function assertions from
// the deleted tests/run-tests-harness.test.cjs (subprocess-driving assertions
// for removed machinery like reporter massaging / ensureBuilt* are dropped).
//
// Drives the harness through its exported pure IR (suiteOf, listFiles,
// parseShardArg, selectShard, selectExplicitFiles, packChunks, makeFileWeigher,
// loadTestTimings) rather than the subprocess seam — the cheapest, most precise
// way to pin these contracts.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createTempDir, cleanup } = require('./helpers.cjs');

const {
  SUITES,
  suiteOf,
  listFiles,
  selectExplicitFiles,
  parseShardArg,
  selectShard,
  packChunks,
  makeFileWeigher,
  loadTestTimings,
  positiveNumberEnv,
  DEFAULT_TIMINGS_PATH,
} = require('../scripts/test-suites.cjs');

// ─── suiteOf marker mapping (#3597) ─────────────────────────────────────────

describe('suiteOf marker mapping', () => {
  test('marked suites classify by the suffix before .test.cjs', () => {
    assert.strictEqual(suiteOf('foo.security.test.cjs'), 'security');
    assert.strictEqual(suiteOf('foo.integration.test.cjs'), 'integration');
    assert.strictEqual(suiteOf('foo.install.test.cjs'), 'install');
    assert.strictEqual(suiteOf('foo.slow.test.cjs'), 'slow');
  });

  test('unmarked files classify as null (unit)', () => {
    assert.strictEqual(suiteOf('foo.test.cjs'), null);
    assert.strictEqual(suiteOf('sub/dir/foo.test.cjs'), null);
  });

  test('non-test files classify as null', () => {
    assert.strictEqual(suiteOf('foo.cjs'), null);
    assert.strictEqual(suiteOf('foo.spec.js'), null);
    assert.strictEqual(suiteOf('README.md'), null);
  });

  test('an unknown marker suffix classifies as null (unit)', () => {
    assert.strictEqual(suiteOf('foo.e2e.test.cjs'), null);
    assert.strictEqual(suiteOf('foo.unknown.test.cjs'), null);
  });

  test('classification is based on the basename only', () => {
    assert.strictEqual(suiteOf('deep/nested/foo.security.test.cjs'), 'security');
    assert.strictEqual(suiteOf('a/b/c/foo.test.cjs'), null);
  });
});

// ─── listFiles + suite partition ────────────────────────────────────────────

describe('listFiles suite enumeration', () => {
  test('listFiles("all") returns every *.test.cjs under tests/', () => {
    const all = listFiles('all');
    assert.ok(all.length > 0, 'the real suite must have test files');
    for (const f of all) {
      assert.ok(f.endsWith('.test.cjs'), `every entry must be a test file: ${f}`);
    }
    // No duplicates.
    assert.strictEqual(new Set(all).size, all.length, 'listFiles must not duplicate');
  });

  test('unit + integration + install + security + slow partitions "all" disjointly', () => {
    const all = listFiles('all');
    const allSet = new Set(all);
    const unit = listFiles('unit');
    const integration = listFiles('integration');
    const install = listFiles('install');
    const security = listFiles('security');
    const slow = listFiles('slow');
    // Every file in a marked suite is in "all".
    for (const f of [...integration, ...install, ...security, ...slow]) {
      assert.ok(allSet.has(f), `marked-suite file ${f} must be in all`);
    }
    // unit = all minus the marked suites.
    const marked = new Set([...integration, ...install, ...security, ...slow]);
    const expectedUnit = all.filter((f) => !marked.has(f));
    assert.deepStrictEqual(
      [...unit].sort(),
      [...expectedUnit].sort(),
      'unit must be exactly the unmarked files',
    );
    // No file appears in two marked suites.
    const allMarked = [...integration, ...install, ...security, ...slow];
    assert.strictEqual(new Set(allMarked).size, allMarked.length, 'marked suites must be disjoint');
  });
});

// ─── parseShardArg (#1212) ──────────────────────────────────────────────────

describe('parseShardArg (#1212)', () => {
  test('parses i/n into { index, total }', () => {
    assert.deepStrictEqual(parseShardArg('2/3'), { index: 2, total: 3 });
    assert.deepStrictEqual(parseShardArg('1/1'), { index: 1, total: 1 });
  });

  const bad = ['', '2', '0/3', '4/3', '1/0', '-1/3', '1.5/3', 'a/b', '1/3/2', ' 1/3', '1 / 3'];
  for (const v of bad) {
    test(`rejects malformed/out-of-range value ${JSON.stringify(v)}`, () => {
      const r = parseShardArg(v);
      assert.ok(r && r.error, `expected an error result for ${JSON.stringify(v)}, got ${JSON.stringify(r)}`);
    });
  }
});

// ─── selectShard round-robin partition (#1212) ──────────────────────────────

describe('selectShard round-robin partition (#1212)', () => {
  const files = Array.from({ length: 25 }, (_, i) => `f${String(i).padStart(3, '0')}.test.cjs`);

  test('n=1 returns the full list unchanged (pure no-op)', () => {
    assert.deepStrictEqual(selectShard(files, { index: 1, total: 1 }), files);
  });

  test('completeness: the union of all shards equals the full list', () => {
    const n = 4;
    const union = [];
    for (let i = 1; i <= n; i++) union.push(...selectShard(files, { index: i, total: n }));
    assert.deepStrictEqual([...union].sort(), [...files].sort());
  });

  test('disjointness: no file appears in two shards', () => {
    const n = 4;
    const seen = new Set();
    for (let i = 1; i <= n; i++) {
      for (const f of selectShard(files, { index: i, total: n })) {
        assert.ok(!seen.has(f), `file ${f} appeared in more than one shard`);
        seen.add(f);
      }
    }
    assert.strictEqual(seen.size, files.length);
  });

  test('balance: shard sizes differ by at most 1', () => {
    const n = 4;
    const sizes = [];
    for (let i = 1; i <= n; i++) sizes.push(selectShard(files, { index: i, total: n }).length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `sizes=${sizes}`);
  });

  test('determinism: same input yields the same partition', () => {
    const a = selectShard(files, { index: 2, total: 3 });
    const b = selectShard(files, { index: 2, total: 3 });
    assert.deepStrictEqual(a, b);
  });

  test('round-robin: shard i gets indices i-1, i-1+n, i-1+2n, …', () => {
    const n = 3;
    assert.deepStrictEqual(
      selectShard(files, { index: 1, total: n }),
      files.filter((_, k) => k % n === 0),
    );
    assert.deepStrictEqual(
      selectShard(files, { index: 2, total: n }),
      files.filter((_, k) => k % n === 1),
    );
    assert.deepStrictEqual(
      selectShard(files, { index: 3, total: n }),
      files.filter((_, k) => k % n === 2),
    );
  });

  test('preserves relative order within a shard', () => {
    const slice = selectShard(files, { index: 1, total: 3 });
    const sorted = [...slice].sort();
    assert.deepStrictEqual(slice, sorted);
  });

  test('empty shard when total > file count returns []', () => {
    const two = ['a.test.cjs', 'b.test.cjs'];
    assert.deepStrictEqual(selectShard(two, { index: 5, total: 5 }), []);
    assert.deepStrictEqual(selectShard(two, { index: 3, total: 5 }), []);
    assert.deepStrictEqual(selectShard(two, { index: 1, total: 5 }), ['a.test.cjs']);
    assert.deepStrictEqual(selectShard(two, { index: 2, total: 5 }), ['b.test.cjs']);
  });

  test('boundary: total exactly equals file count → one file per shard', () => {
    const three = ['a.test.cjs', 'b.test.cjs', 'c.test.cjs'];
    for (let i = 1; i <= 3; i++) {
      assert.strictEqual(selectShard(three, { index: i, total: 3 }).length, 1);
    }
  });

  test('property: partition is complete, disjoint, and balanced for any n,N', () => {
    const fc = require('fast-check');
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 12 }),
        (rawFiles, n) => {
          const list = [...new Set(rawFiles)].sort();
          const shards = [];
          for (let i = 1; i <= n; i++) shards.push(selectShard(list, { index: i, total: n }));
          const flat = shards.flat();
          assert.deepStrictEqual([...flat].sort(), [...list].sort());
          assert.strictEqual(new Set(flat).size, list.length);
          const sizes = shards.map((s) => s.length);
          assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `sizes=${sizes}`);
        },
      ),
      { numRuns: 200, seed: 12120 },
    );
  });
});

// ─── selectShard weight-aware partition (#2472) ────────────────────────────

describe('selectShard weight-aware partition (#2472)', () => {
  const fc = require('fast-check');

  const shardWeights = (files, total, weightOf) => {
    const out = [];
    for (let i = 1; i <= total; i++) {
      out.push(selectShard(files, { index: i, total }, weightOf).reduce((a, f) => a + weightOf(f), 0));
    }
    return out;
  };

  const skewed = {
    'a01.test.cjs': 30000, 'a02.test.cjs': 100, 'a03.test.cjs': 100,
    'a04.test.cjs': 28000, 'a05.test.cjs': 100, 'a06.test.cjs': 100,
    'a07.test.cjs': 26000, 'a08.test.cjs': 100, 'a09.test.cjs': 100,
    'a10.test.cjs': 24000, 'a11.test.cjs': 100, 'a12.test.cjs': 100,
  };
  const skewedFiles = Object.keys(skewed).sort();
  const skewedWeight = (f) => skewed[f];

  test('REGRESSION: round-robin clusters heavy files; LPT does not', () => {
    const ideal = Object.values(skewed).reduce((a, b) => a + b, 0) / 3;
    const rr = [1, 2, 3].map((i) =>
      selectShard(skewedFiles, { index: i, total: 3 }).reduce((a, f) => a + skewedWeight(f), 0));
    const lpt = shardWeights(skewedFiles, 3, skewedWeight);
    assert.ok(
      Math.max(...rr) / ideal > 1.5,
      `round-robin should be badly imbalanced on skewed costs; got ${rr} (ideal ${ideal})`,
    );
    const heaviest = Math.max(...Object.values(skewed));
    assert.ok(
      Math.max(...lpt) <= ideal + heaviest,
      `LPT must hold the average+max bound; got ${lpt} (bound ${ideal + heaviest})`,
    );
    assert.ok(
      Math.max(...lpt) < Math.max(...rr),
      `LPT must beat round-robin on skewed costs; lpt=${lpt} rr=${rr}`,
    );
  });

  test('back-compat: omitting the weigher reproduces round-robin exactly', () => {
    for (let i = 1; i <= 3; i++) {
      assert.deepStrictEqual(
        selectShard(skewedFiles, { index: i, total: 3 }),
        skewedFiles.filter((_, k) => k % 3 === i - 1),
        'the unweighted path must stay byte-identical to the legacy partition',
      );
    }
  });

  test('a uniform weigher degenerates to equal counts', () => {
    const sizes = [1, 2, 3].map(
      (i) => selectShard(skewedFiles, { index: i, total: 3 }, () => 1).length,
    );
    assert.ok(
      Math.max(...sizes) - Math.min(...sizes) <= 1,
      `equal weights must give equal counts; got ${sizes}`,
    );
  });

  test('n=1 is still a pure no-op with a weigher', () => {
    assert.deepStrictEqual(selectShard(skewedFiles, { index: 1, total: 1 }, skewedWeight), skewedFiles);
  });

  test('property: the weighted partition is exhaustive and disjoint', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 60000 }), { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 1, max: 8 }),
        (weights, total) => {
          const files = weights.map((_, i) => `p${String(i).padStart(3, '0')}.test.cjs`);
          const w = (f) => weights[Number(f.slice(1, 4))];
          const seen = [];
          for (let i = 1; i <= total; i++) seen.push(...selectShard(files, { index: i, total }, w));
          assert.strictEqual(new Set(seen).size, seen.length, 'a file appeared in two shards');
          assert.deepStrictEqual([...seen].sort(), [...files].sort(), 'a file was dropped or invented');
        },
      ),
      { numRuns: 200, seed: 24720 },
    );
  });

  test('REGRESSION: zero weights still split evenly across shards', () => {
    const files = Array.from({ length: 9 }, (_, i) => `z${i}.test.cjs`);
    const sizes = [1, 2, 3].map((i) => selectShard(files, { index: i, total: 3 }, () => 0).length);
    assert.deepStrictEqual(sizes, [3, 3, 3], `all-zero weights must not collapse onto one shard; got ${sizes}`);
  });
});

// ─── chunk packing weights measured cost (#2456) ────────────────────────────

describe('chunk packing weights measured cost (#2456)', () => {
  const MEASURED_MS = {
    'test-suites.test.cjs': 150180,
    'release-tarball-smoke.install.test.cjs': 144420,
    'phase.test.cjs': 136770,
    'install-minimal-hooks.test.cjs': 136330,
    'config.test.cjs': 114420,
    'state.test.cjs': 94290,
    'commands.test.cjs': 70580,
    'init.test.cjs': 64100,
    'installer-migration-authoring.test.cjs': 90,
    'installer-migration-report.test.cjs': 120,
    'install-update-marker.test.cjs': 95,
    'codex-declarative-reference.test.cjs': 110,
  };
  const FILES = Object.keys(MEASURED_MS);
  const FIXED_OVERHEAD = 120;
  const ROOMY_CHARS = 100000;

  function tableFrom(timings) {
    const tmp = createTempDir('gsd-2456-timings-');
    const p = path.join(tmp, 'timings.json');
    fs.writeFileSync(p, JSON.stringify({ schema_version: 1, unit: 'ms', timings }), 'utf8');
    return { path: p, dir: tmp };
  }

  function packMeasured(files, maxWeight, extra = {}) {
    const t = tableFrom(MEASURED_MS);
    try {
      return packChunks(files, {
        weightOf: makeFileWeigher(loadTestTimings(t.path)),
        maxWeight,
        maxChars: ROOMY_CHARS,
        fixedOverhead: FIXED_OVERHEAD,
        ...extra,
      });
    } finally {
      cleanup(t.dir);
    }
  }

  const costOf = (chunk) => chunk.reduce((sum, f) => sum + MEASURED_MS[f], 0);

  test('the two most expensive files never land in the same chunk', () => {
    const chunks = packMeasured(FILES, 4);
    const chunkOf = (f) => chunks.findIndex((c) => c.includes(f));
    const a = chunkOf('test-suites.test.cjs');
    const b = chunkOf('release-tarball-smoke.install.test.cjs');
    assert.ok(a !== -1 && b !== -1, 'both heavy files must be packed');
    assert.notStrictEqual(
      a,
      b,
      `the two most expensive files must be split across chunks; got both in chunk ${a + 1}`,
    );
  });

  test('chunk costs are balanced — slowest chunk stays well under 2x the fastest', () => {
    const chunks = packMeasured(FILES, 4);
    const costs = chunks.map(costOf);
    const ratio = Math.max(...costs) / Math.min(...costs);
    assert.ok(ratio < 2, `LPT must balance measured cost; imbalance was ${ratio.toFixed(2)}x`);
  });

  test('an average-cost file weighs exactly 1, preserving the MAX_FILES_PER_CHUNK scale', () => {
    const t = tableFrom({ 'a.test.cjs': 10000, 'b.test.cjs': 20000, 'c.test.cjs': 30000 });
    try {
      const weigh = makeFileWeigher(loadTestTimings(t.path));
      assert.strictEqual(weigh('b.test.cjs'), 1, 'the mean-cost file must weigh 1');
      assert.strictEqual(weigh('a.test.cjs'), 0.5);
      assert.strictEqual(weigh('c.test.cjs'), 1.5);
    } finally {
      cleanup(t.dir);
    }
  });

  describe('timings are advisory, never gated', () => {
    test('a file missing from the table falls back to the median weight', () => {
      const t = tableFrom({ 'a.test.cjs': 10000, 'b.test.cjs': 20000, 'c.test.cjs': 60000 });
      try {
        const weigh = makeFileWeigher(loadTestTimings(t.path));
        assert.strictEqual(weigh('brand-new-test.test.cjs'), 20000 / 30000);
      } finally {
        cleanup(t.dir);
      }
    });

    test('a missing timings file degrades to uniform weight, not an error', () => {
      const missing = path.join(__dirname, 'no-such-dir-2456', 'does-not-exist.json');
      assert.strictEqual(loadTestTimings(missing), null, 'a missing table must load as null');
      const weigh = makeFileWeigher(null);
      assert.strictEqual(weigh('anything.test.cjs'), 1, 'a null table must weigh every file 1');
    });

    test('a corrupt timings file degrades to uniform weight, not an error', () => {
      const tmp = createTempDir('gsd-2456-corrupt-');
      try {
        const p = path.join(tmp, 'timings.json');
        fs.writeFileSync(p, '{ this is not json', 'utf8');
        assert.strictEqual(loadTestTimings(p), null, 'unparseable JSON must load as null');
      } finally {
        cleanup(tmp);
      }
    });

    test('a structurally valid but empty table degrades to uniform weight', () => {
      const t = tableFrom({});
      try {
        assert.strictEqual(loadTestTimings(t.path), null, 'an empty table must load as null');
      } finally {
        cleanup(t.dir);
      }
    });
  });

  describe('packing invariants', () => {
    test('every selected file is packed exactly once', () => {
      const chunks = packMeasured(FILES, 3);
      const flat = chunks.flat();
      assert.strictEqual(flat.length, FILES.length, 'no file may be dropped or duplicated');
      assert.deepStrictEqual([...flat].sort(), [...FILES].sort(), 'the packed set must equal the selection');
    });

    test('packing is deterministic — identical input yields byte-identical chunks', () => {
      assert.deepStrictEqual(packMeasured(FILES, 4), packMeasured(FILES, 4));
    });
  });

  describe('degenerate knobs degrade safely', () => {
    const files = ['a.test.cjs', 'b.test.cjs', 'c.test.cjs'];
    const packWith = (opts) =>
      packChunks(files, {
        weightOf: () => 1,
        maxWeight: 60,
        maxChars: ROOMY_CHARS,
        fixedOverhead: FIXED_OVERHEAD,
        ...opts,
      });
    const conserves = (chunks) =>
      JSON.stringify(chunks.flat().sort()) === JSON.stringify([...files].sort());

    for (const [label, opts] of [
      ['a NaN weight budget', { maxWeight: NaN }],
      ['a zero weight budget', { maxWeight: 0 }],
      ['a NaN argv ceiling', { maxChars: NaN }],
      ['a weight function returning NaN', { weightOf: () => NaN }],
    ]) {
      test(`${label} still packs every file exactly once`, () => {
        const chunks = packWith(opts);
        assert.ok(conserves(chunks), `${label} must still pack all files; got ${JSON.stringify(chunks)}`);
      });
    }

    test('positiveNumberEnv falls back for every non-positive-finite input', () => {
      for (const bad of [undefined, null, '', '   ', 'abc', '0', '-1', 'NaN', 'Infinity', '1e999']) {
        assert.strictEqual(
          positiveNumberEnv(bad, 60),
          60,
          `${JSON.stringify(bad)} must fall back to the default`,
        );
      }
    });
  });

  describe('the checked-in timings table', () => {
    test('loads, is non-empty, and yields usable weights', () => {
      const table = loadTestTimings(DEFAULT_TIMINGS_PATH);
      assert.ok(table !== null, `${DEFAULT_TIMINGS_PATH} must parse into a usable timing table`);
      assert.ok(Object.keys(table.timings).length > 0, 'the table must not be empty');
      assert.ok(table.mean > 0, 'the table mean must be positive');
    });

    test('every recorded cost is a finite non-negative number', () => {
      const table = loadTestTimings(DEFAULT_TIMINGS_PATH);
      const invalid = Object.entries(table.timings)
        .filter(([, value]) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        .map(([file, value]) => `${file}=${value}`);
      assert.deepStrictEqual(invalid, [], 'every timing-table entry must be a finite non-negative number');
    });
  });
});

// ─── --files-from sentinel expansion (#408/#641) ────────────────────────────

describe('selectExplicitFiles sentinel expansion (#408/#641)', () => {
  test('a bare suite-name token expands to that suite live file list', () => {
    const all = listFiles('all');
    const unit = listFiles('unit');
    // Simulate a --files-from file containing "unit" on its own line.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sentinel-'));
    try {
      const listPath = path.join(tmp, 'sel.txt');
      fs.writeFileSync(listPath, 'unit\n', 'utf8');
      const r = selectExplicitFiles(all, null, listPath);
      assert.ok(!r.error, `sentinel expansion must not error: ${r.error}`);
      assert.deepStrictEqual(
        [...r.files].sort(),
        [...unit].sort(),
        'the "unit" sentinel must expand to the live unit file list',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('an explicit test path passes through unchanged', () => {
    const all = listFiles('all');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sentinel-'));
    try {
      const listPath = path.join(tmp, 'sel.txt');
      fs.writeFileSync(listPath, 'io.test.cjs\n', 'utf8');
      const r = selectExplicitFiles(all, null, listPath);
      assert.ok(!r.error);
      assert.ok(r.files.includes('io.test.cjs'), 'the explicit path must be selected');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('blank lines are dropped', () => {
    const all = listFiles('all');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sentinel-'));
    try {
      const listPath = path.join(tmp, 'sel.txt');
      fs.writeFileSync(listPath, '\n\nio.test.cjs\n\n', 'utf8');
      const r = selectExplicitFiles(all, null, listPath);
      assert.ok(!r.error);
      assert.deepStrictEqual(r.files, ['io.test.cjs'], 'blanks must be dropped, only the real path kept');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a missing file surfaces an error, not a silent empty selection', () => {
    const all = listFiles('all');
    const r = selectExplicitFiles(all, 'does-not-exist.test.cjs', null);
    assert.ok(r.error, 'a missing file must produce an error');
  });
});
