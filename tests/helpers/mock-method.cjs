'use strict';
// Bun's node:test bridge does not implement t.mock (bun#5090). This helper
// mirrors the node:test semantics this suite uses: 3-arg patch with impl,
// 2-arg recording stub (returns undefined), .mock.calls, .mock.restore(),
// t.mock.restoreAll(), and auto-restore after each test.
//
// Two entry points:
//  - mockMethod(t, obj, name, impl) — for TEST BODIES with a TestContext.
//    Registers auto-restore via t.after, which fires at test end under BOTH
//    node:test and Bun (Bun DOES fire t.after registered in a test body, but
//    drops t.after registered inside hooks like beforeEach — bun#5090).
//  - mockRestoreAll(t) — explicit restore-all for a given t (rarely needed;
//    the auto-restore covers test-body mocks).
//
// For HOOKS (beforeEach/afterEach) where the mock must persist across the
// test body, do NOT use mockMethod(t,...) under Bun (t.after in a hook is
// dropped). Use mockRaw and own the lifecycle:
//    const hookMocks = [];
//    beforeEach(() => { hookMocks.push(mockRaw(obj, 'name', impl)); });
//    afterEach(() => { for (const m of hookMocks.splice(0)) m.mock.restore(); });

const registries = new WeakMap(); // t -> [restoreFn, ...]

function install(obj, name, impl) {
  const original = obj[name];
  const calls = [];
  let restored = false;
  const mockFn = function (...args) {
    calls.push({ arguments: args, thisValue: this });
    // node:test's 2-arg mock.method(obj, name) with NO impl is a SPY that
    // calls through to the original and returns its result. The 3-arg form
    // replaces with impl. Match that contract so 2-arg spies keep working.
    return typeof impl === 'function' ? impl.apply(this, args) : original.apply(this, args);
  };
  const restore = () => {
    if (!restored) { obj[name] = original; restored = true; }
  };
  mockFn.mock = { calls, restore };
  obj[name] = mockFn;
  return mockFn;
}

// Test-body mock: auto-restores via t.after at test end (both runners).
function mockMethod(t, obj, name, impl) {
  const mockFn = install(obj, name, impl);
  let reg = registries.get(t);
  if (!reg) { reg = []; registries.set(t, reg); t.after(() => mockRestoreAll(t)); }
  reg.push(mockFn.mock.restore);
  return mockFn;
}

function mockRestoreAll(t) {
  const reg = registries.get(t) || [];
  for (const restore of reg) restore();
  registries.delete(t);
}

// Hook mock: caller owns the lifecycle. Returns a mockFn whose
// .mock.restore() swaps the original back. Push onto a list and restore in
// the matching afterEach.
function mockRaw(obj, name, impl) {
  return install(obj, name, impl);
}

module.exports = { mockMethod, mockRestoreAll, mockRaw };
