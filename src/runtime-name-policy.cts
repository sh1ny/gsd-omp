/**
 * Runtime name policy — alias resolution and canonicalization for GSD runtime
 * identifiers (ADR-457 build-at-publish: the hand-written
 * bin/lib/runtime-name-policy.cjs collapsed to a TypeScript source of truth).
 * Behaviour is preserved byte-for-behaviour from the prior hand-written .cjs;
 * only types are added.
 *
 * Group C cross-import candidate: no bin/lib sibling dependencies; only
 * node:fs and node:path. Once this module is migrated, runtime-slash.cjs
 * (which imports runtime-name-policy.cjs) becomes the first true cross-import
 * proof candidate.
 */

import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_ALIASES: Readonly<Record<string, string[]>> = {
  omp: ['omp', 'oh-my-pi', 'oh-my-pi-cli'],
};

function normalizeRuntimeToken(value: string): string {
  return String(value).trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function loadAliasManifest(): Record<string, string[]> {
  const manifestCandidates = [
    path.resolve(__dirname, '..', 'shared', 'runtime-aliases.manifest.json'),
    path.resolve(__dirname, '../../../sdk/shared/runtime-aliases.manifest.json'),
  ];
  for (const manifestPath of manifestCandidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
    } catch {
      // Try next candidate.
    }
  }
  return { ...FALLBACK_ALIASES };
}

const aliasManifest = loadAliasManifest();
const aliasToCanonical = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(aliasManifest)) {
  if (typeof canonical !== 'string' || !Array.isArray(aliases)) continue;
  aliasToCanonical.set(normalizeRuntimeToken(canonical), normalizeRuntimeToken(canonical));
  for (const alias of aliases) {
    if (typeof alias !== 'string') continue;
    aliasToCanonical.set(normalizeRuntimeToken(alias), normalizeRuntimeToken(canonical));
  }
}

export function canonicalizeRuntimeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return aliasToCanonical.get(normalizeRuntimeToken(value)) || null;
}

/**
 * Resolve runtime from a precedence list of candidate values.
 *
 * - First non-empty string candidate wins.
 * - Known aliases are canonicalized (codex-cli -> codex).
 * - Unknown values are normalized and returned (future-runtime tolerance).
 *
 * @param candidates - string candidates in precedence order
 * @returns the resolved runtime name, or null if no valid candidate
 */
export function resolveRuntimeNameFromCandidates(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeRuntimeToken(candidate);
    if (!normalized) continue;
    return canonicalizeRuntimeName(normalized) || normalized;
  }
  return null;
}

/**
 * Map a runtime id to its project instruction file path (relative to project
 * root). Bug #1529: this is the SINGLE source of truth shared by both
 * consumption surfaces —
 *   (A) the Node surface: profile-output.cjs (generate-claude-md handler)
 *   (B) the bash surface: `gsd-tools query project-instruction-file --runtime <r>`,
 *       consumed by gsd-core/workflows/new-project.md to set $INSTRUCTION_FILE
 *
 * Mapping table (per the #1529 issue contract):
 *
 *   claude                      → .claude/CLAUDE.md
 *   codex, opencode, kilo, kimi → AGENTS.md
 *   copilot                     → .github/copilot-instructions.md
 *   antigravity                 → GEMINI.md
 *   unknown / future runtimes   → AGENTS.md (safe cross-agent default)
 *
 * Source-of-truth references for each runtime's read path:
 *   - copilot: GitHub Docs — repository-wide custom instructions are read ONLY
 *     from `.github/copilot-instructions.md`; a root `copilot-instructions.md`
 *     is not a read path. `AGENTS.md` is also read (agent instructions).
 *     https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
 *     (Installer parity: runtime-config-adapter-registry.cts installSurface
 *     'copilot-instructions' writes the same `.github/copilot-instructions.md`.)
 *   - codex/opencode/kilo/kimi: AGENTS.md is the documented cross-agent
 *     instruction file (agentsmd/agents.md convention).
 *   - antigravity: GEMINI.md is Antigravity CLI's contextFileName (the Gemini
 *     CLI runtime that historically shared this file was removed — #1928;
 *     Google sunset Gemini CLI 2026-06-18 and Antigravity CLI is its successor).
 *
 * Aliases are normalized via `canonicalizeRuntimeName` first, so inputs like
 * `codex-cli` resolve to `codex` → `AGENTS.md`. Replaces the prior codex-only
 * override in profile-output.cjs (#3163) which left AGENTS-native runtimes
 * (opencode/kilo/kimi) incorrectly emitting `.claude/CLAUDE.md`. Pure: no I/O
 * (the lazy `require` below reads a static generated module, not the disk).
 *
 * Descriptor-driven (ADR-1239 / #2096): antigravity's `GEMINI.md` is folded
 * from a hardcoded `canonical === 'antigravity'` literal into a read of
 * `runtime.hostBehaviors.projectInstructionFile`. claude/copilot stay
 * hardcoded (out of scope here) mirroring `getDirName` below, which already
 * lazy-`require`s `capability-registry.cjs` inside the function body to
 * avoid a circular dependency at module load.
 */
export function getProjectInstructionFile(runtime: unknown): string {
  const canonical = canonicalizeRuntimeName(runtime);
  if (canonical === 'claude') return '.claude/CLAUDE.md';
  if (canonical === 'copilot') return '.github/copilot-instructions.md';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runtimes } = require('./capability-registry.cjs') as {
    runtimes: Record<string, { runtime?: { hostBehaviors?: { projectInstructionFile?: string } } } | undefined>;
  };
  const declared = canonical ? runtimes[canonical]?.runtime?.hostBehaviors?.projectInstructionFile : undefined;
  if (typeof declared === 'string' && declared.length > 0) return declared;
  // codex, opencode, kilo, kimi, AND unknown/future runtimes all default to
  // root AGENTS.md (the safe cross-agent instruction file).
  return 'AGENTS.md';
}

/**
 * Sentinel returned by {@link getDirName} for a runtime whose
 * `runtime.configHome.kind === 'none'` (#2103 — a Marketplace/VSIX-distributed
 * host with NO file-projected config directory at all, e.g. VS Code).
 *
 * A plain fallback to `.claude` would be actively wrong here — it would read
 * as "this runtime installs into .claude", which is false. This sentinel is
 * a string (not `null`) so `getDirName`'s return type and every existing
 * template-literal call site (`` `${getDirName(runtime)}` `` in bin/install.js
 * / runtime-artifact-conversion.cjs / install-engine.cjs) are unaffected —
 * widening the return type to `string | null` would require auditing every
 * call site for a null-check, which is out of scope for a runtime that is
 * never actually dispatched through those installer paths (vscode has no
 * install surface — see capabilities/vscode/capability.json). The value is
 * deliberately NOT a plausible dot-dir name (parens are not valid in a
 * directory-name token GSD would ever generate) so a future caller that
 * mistakenly interpolates it into a path fails obviously rather than
 * silently colliding with a real directory.
 */
export const NO_LOCAL_CONFIG_DIR_SENTINEL = '(no-local-config-dir)';

/**
 * Map a canonical runtime id to its on-disk local config directory name
 * (e.g. `cursor` -> `.cursor`, `windsurf` -> `.windsurf`). Unknown/empty inputs
 * fall back to `.claude`.
 *
 * #2103: a runtime whose descriptor declares `configHome.kind === 'none'`
 * (no file-projected config directory at all) returns
 * {@link NO_LOCAL_CONFIG_DIR_SENTINEL} instead of falling through to
 * `.claude` — it has no local config dir, and `.claude` would be a wrong
 * answer, not just an imprecise one.
 *
 * Pure runtime-identity projection. Relocated from `bin/install.js` per
 * ADR-1508 (epic #1507, #1510 Phase 1) so the Runtime Artifact Conversion
 * Module's rewrite engine can consume it without importing the installer.
 * `bin/install.js` re-exports this same function for back-compat.
 */
export function getDirName(runtime: string): string {
  if (!runtime) return '.claude';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runtimes } = require('./capability-registry.cjs') as {
    runtimes: Record<string, { runtime?: { localConfigDir?: string; configHome?: { kind?: string } } } | undefined>;
  };
  const entry = runtimes[runtime]?.runtime;
  const dir = entry?.localConfigDir;
  if (typeof dir === 'string' && dir.length > 0) return dir;
  if (entry?.configHome?.kind === 'none') return NO_LOCAL_CONFIG_DIR_SENTINEL;
  return '.claude';
}

/**
 * Curated short display labels for the install/uninstall console output, keyed
 * by canonical runtime id. The SINGLE source of truth consumed by both
 * `install()` and `uninstall()` in bin/install.js via `getRuntimeLabel`.
 *
 * The drift-guard test (tests/runtime-label-policy.test.cjs) pins this table's
 * id set to the capability-registry runtime id set, so adding/removing a runtime
 * forces a deliberate update here.
 */
const RUNTIME_LABELS: Readonly<Record<string, string>> = {
  omp: 'Oh My Pi',
};

/**
 * Map a canonical runtime id to its short display label for the
 * install/uninstall console output. Unknown/empty inputs fall back to
 * 'Oh My Pi'. Sibling to `getDirName`; pure (no I/O).
 */
export function getRuntimeLabel(runtime: string): string {
  if (!runtime) return 'Oh My Pi';
  const label = RUNTIME_LABELS[runtime];
  return typeof label === 'string' && label.length > 0 ? label : 'Oh My Pi';
}

/**
 * Source-string fragments for the runtime → global config-home path, used by
 * `getConfigDirFromHome` in bin/install.js to template `path.join()` calls in
 * generated hook scripts. Each value is a JS-source snippet (embedded quotes /
 * commas are intentional — it is spliced into generated code as path.join args).
 *
 * Unknown/empty ids fall back to the default (`.omp`, `agent`).
 */
const DEFAULT_CONFIG_HOME_FRAGMENT = "'.omp', 'agent'";
const GLOBAL_CONFIG_HOME_FRAGMENTS: Readonly<Record<string, string>> = {
  omp: "'.omp', 'agent'",
};

/**
 * Return the global config-home path-fragment source snippet for a runtime
 * (for hook path.join() codegen). Unknown/empty → the default `'.omp', 'agent'`
 * fragment. Pure: no I/O. Sibling to `getDirName` / `getRuntimeLabel`.
 */
export function getGlobalConfigHomeFragment(runtime: string): string {
  if (!runtime) return DEFAULT_CONFIG_HOME_FRAGMENT;
  const frag = GLOBAL_CONFIG_HOME_FRAGMENTS[runtime];
  return typeof frag === 'string' && frag.length > 0 ? frag : DEFAULT_CONFIG_HOME_FRAGMENT;
}

/**
 * The runtime ids for which `bin/install.js` needs an `is<Runtime>` boolean
 * predicate. Single source of truth — adding a runtime is one entry here.
 */
const RUNTIME_FLAG_IDS = Object.freeze([
  'omp',
] as const);

/**
 * Convert a runtime id (kebab-case, e.g. 'kimi-code') to its `is<Foo>` flag
 * name in PascalCase (e.g. 'isKimiCode'). The first letter is capitalised and
 * every `-[a-z]` boundary is folded to its uppercase twin. Single-word ids
 * (the prior 16: opencode, kilo, codex, …) are unaffected — only hyphenated
 * ids like 'kimi-code' (#2454) hit the folding branch.
 */
function runtimeIdToFlagName(id: string): string {
  return 'is' + id.charAt(0).toUpperCase() + id.slice(1).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Return a frozen map of `is<Runtime>` boolean predicates for the given runtime
 * id (e.g. `flags.isOpencode`). Collapses the four duplicated `const isX =
 * runtime === 'x'` declaration blocks that lived in `bin/install.js`'s
 * `uninstall`/`writeManifest`/`install`/etc. into one helper (sibling to
 * `getDirName`/`getRuntimeLabel`). Pure: no I/O.
 */
export function runtimeFlags(runtime: string): Readonly<Record<string, boolean>> {
  const flags: Record<string, boolean> = {};
  for (const id of RUNTIME_FLAG_IDS) {
    flags[runtimeIdToFlagName(id)] = runtime === id;
  }
  return Object.freeze(flags);
}

/**
 * The `/gsd-new-project` invocation syntax — the post-install "next step"
 * command string. Pure: no I/O.
 */
const DEFAULT_NEW_PROJECT_COMMAND = '/gsd-new-project';
const RUNTIME_NEW_PROJECT_COMMANDS: Readonly<Record<string, string>> = {};

export function getRuntimeNewProjectCommand(runtime: string): string {
  if (!runtime) return DEFAULT_NEW_PROJECT_COMMAND;
  const c = RUNTIME_NEW_PROJECT_COMMANDS[runtime];
  return typeof c === 'string' && c.length > 0 ? c : DEFAULT_NEW_PROJECT_COMMAND;
}
