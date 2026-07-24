'use strict';

process.env.GSD_TEST_MODE = '1';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getDirName,
  getConfigDirFromHome,
  selectRuntimesFromArgs,
} = require('../bin/install.js');
const { getGlobalConfigDir } = require('../gsd-core/bin/lib/runtime-homes.cjs');
const { cleanup } = require('./helpers.cjs');

describe('OMP runtime metadata', () => {

  test('uses the OMP local config directory', () => {
    assert.strictEqual(getDirName('omp'), '.omp');
    assert.strictEqual(getConfigDirFromHome('omp', false), "'.omp'");
  });

  test('selects OMP from the CLI flag', () => {
    assert.deepStrictEqual(selectRuntimesFromArgs(['--omp']), ['omp']);
  });
});

describe('getGlobalConfigDir — OMP agent-dir and profile env priority', () => {
  let savedEnv;
  let tmpHome;

  beforeEach(() => {
    savedEnv = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
      PI_CONFIG_DIR: process.env.PI_CONFIG_DIR,
      OMP_PROFILE: process.env.OMP_PROFILE,
      PI_PROFILE: process.env.PI_PROFILE,
    };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-home-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_CONFIG_DIR;
    delete process.env.OMP_PROFILE;
    delete process.env.PI_PROFILE;
  });

  afterEach(() => {
    cleanup(tmpHome);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
  });

  test('default uses <home>/.omp/agent', () => {
    assert.strictEqual(getGlobalConfigDir('omp'), path.join(tmpHome, '.omp', 'agent'));
  });

  test('PI_CODING_AGENT_DIR overrides the default agent dir', () => {
    process.env.PI_CODING_AGENT_DIR = path.join(tmpHome, 'agent');
    assert.strictEqual(getGlobalConfigDir('omp'), path.join(tmpHome, 'agent'));
  });

  test('PI_CONFIG_DIR changes the config root name', () => {
    process.env.PI_CONFIG_DIR = '.custom-omp';
    assert.strictEqual(getGlobalConfigDir('omp'), path.join(tmpHome, '.custom-omp', 'agent'));
  });

  test('OMP_PROFILE uses profile agent dir and ignores PI_CODING_AGENT_DIR', () => {
    process.env.PI_CODING_AGENT_DIR = path.join(tmpHome, 'agent');
    process.env.OMP_PROFILE = 'work';
    assert.strictEqual(getGlobalConfigDir('omp'), path.join(tmpHome, '.omp', 'profiles', 'work', 'agent'));
  });

  test('PI_PROFILE is used when OMP_PROFILE is unset', () => {
    process.env.PI_PROFILE = 'work';
    assert.strictEqual(getGlobalConfigDir('omp'), path.join(tmpHome, '.omp', 'profiles', 'work', 'agent'));
  });
});
