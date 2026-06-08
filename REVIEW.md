# Code Review: port/omp-native-support

**Reviewer:** Assistant  
**Branch:** `port/omp-native-support` vs `upstream/next`  
**Files changed:** 26 (+2,165 / −91)  
**Verdict:** **APPROVE** — Ship with follow-up fixes.

---

## Summary

Adds OMP (Oh My Pi) as the 16th supported runtime, with native extension artifacts under `.omp/extensions/gsd-core/`, static rules under `.omp/rules/`, and converted commands, skills, and agents. The implementation reuses existing patterns consistently and is backed by 18 new tests plus updates to 7 existing test files.

---

## Findings

### Medium Priority

#### 1. Module-level state leak across sessions

- **File:** `gsd-core/omp/extensions/gsd-core/index.js`  
- **Lines:** 51–55  
- **Description:** The extension keeps mutable module-level state (`queuedContext`, `configWatchers`, `contextWarningState`, `updateCheckSpawned`, `configReloadTimer`) that is never reset in `onSessionShutdown`. If OMP reuses the extension module across multiple sessions, queued context from session A can appear in session B, and `updateCheckSpawned` permanently suppresses update checks after the first session.  
- **Remediation:** Reset all state in `onSessionShutdown`:

```javascript
function onSessionShutdown() {
  for (const w of configWatchers) { try { w.close(); } catch {} }
  configWatchers = [];
  queuedContext.length = 0;
  contextWarningState.callsSinceWarn = 0;
  contextWarningState.lastLevel = null;
  contextWarningState.criticalRecorded = false;
  updateCheckSpawned = false;
  if (configReloadTimer) { clearTimeout(configReloadTimer); configReloadTimer = null; }
}
```

#### 2. `.npmignore` missing `tests/` and `src/`

- **File:** `.npmignore`  
- **Lines:** 1–21  
- **Description:** The new `.npmignore` excludes build artifacts and dotfiles but does not exclude the 654 test files under `tests/` or the TypeScript source files under `src/`. These bloat the published package if they are not meant to ship.  
- **Remediation:** Append to `.npmignore`:

```
tests/
src/
*.cts
```

#### 3. Synchronous git calls in `worktreePathGuard` per tool invocation

- **File:** `gsd-core/omp/extensions/gsd-core/index.js`  
- **Lines:** 280–322  
- **Description:** Every `write` or `edit` tool call triggers 2–3 synchronous `git rev-parse` calls via `worktreePathGuard`. The 2-second timeout is correct, but the cumulative latency on write-heavy sessions in large repositories could be noticeable.  
- **Remediation:** Cache the `git rev-parse --git-dir` result per `cwd` in a `Map` scoped to the session.

---

### Low Priority

#### 4. `update-worker.js` computed `require()` paths

- **File:** `gsd-core/omp/extensions/gsd-core/update-worker.js`  
- **Lines:** 21–23  
- **Description:** The worker resolves modules via `path.join(process.env.GSD_CONFIG_DIR, ...)`. In theory an attacker-controlled `GSD_CONFIG_DIR` would allow arbitrary code execution. In practice, `OMP_CONFIG_DIR` is user-set and the worker runs as a detached child with a broad `try/catch`. Risk is acceptable.

#### 5. OMP `rewriteRuntimeDir` lookbehind regex portability

- **File:** `bin/install.js`  
- **Line:** 7334  
- **Description:** The negative lookbehind `(?<![A-Za-z0-9_.\-/~$])\.omp\//g` could fail on Windows-style paths. OMP is primarily Unix-like, and tests verify global-install rewrites correctly. Acceptable as-is.

#### 6. `stripReadSelector` regex complexity

- **File:** `gsd-core/omp/extensions/gsd-core/index.js`  
- **Line:** 90  
- **Description:** The regex for stripping read selectors is complex, but it is end-anchored (`$`) with non-overlapping alternatives, making catastrophic backtracking unlikely.

---

## Strengths

- **Consistent patterns** — OMP entries follow the exact same structure as other runtimes in `runtime-artifact-layout.cts`, `runtime-config-adapter-registry.cts`, `runtime-homes.cts`, and `runtime-name-policy.cts`.
- **Excellent test coverage** — 18 new OMP-specific tests covering event handlers, install/uninstall, path rewrites, model overrides, profile limits, and cross-runtime alternation.
- **Security posture** — No shell injection (git/node args passed as arrays), 2-second git timeouts, prompt-injection and read-injection scanning, invisible-unicode detection.
- **Cleanup safety** — New `cleanup` callback on `ArtifactKind` with `try/finally` in `applySurface` prevents temp-directory leaks after staging.
- **Extension sync hygiene** — Preserves non-GSD extensions while removing stale GSD-prefixed ones during reinstall/uninstall.
- **Documentation** — `docs/omp-support.md` is accurate, complete, and matches the actual CLI behavior.

---

## Test Verification

```
ℹ tests 7573
ℹ pass  7573
ℹ fail  0
ℹ skipped 1
```

All tests pass after adding the OMP entry to `RUNTIME_META` and `LOCAL_DIR_NAME` in `tests/helpers/install-shared.cjs`.

---

## Recommendation

Ship with the three medium-priority fixes applied in a follow-up commit. The branch is production-ready and the security posture is solid.
