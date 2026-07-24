/**
 * runtime-slash.cts — single source of truth for emitting GSD slash-command
 * references in user-facing runtime output (recommended-actions JSON, persisted
 * ROADMAP.md entries, verify/validate fix hints, error messages, etc.).
 *
 * ADR-457 build-at-publish: the hand-written bin/lib/runtime-slash.cjs collapsed
 * to a TypeScript source of truth. Behaviour is preserved byte-for-behaviour from
 * the prior hand-written .cjs; only types are added.
 *
 * Background: #2808 unified all GSD skill installs to register under the hyphen
 * form (`name: gsd-<cmd>`). The legacy colon form `/gsd:<cmd>` is no longer
 * routable by Claude Code skill installs, but ~50 runtime emissions in
 * bin/lib/*.cjs still hardcoded it (#3584). Codex installs need the shell-var
 * `$gsd-<cmd>` form. This module is the only place the runtime should decide
 * which shape to emit.
 *
 *   - codex:                                   $gsd-<cmd>   (shell-var syntax)
 *   - claude, cursor, opencode, kilo, etc.:    /gsd-<cmd>
 *
 * The colon form is never emitted.
 *
 * Cross-import proof candidate (ADR-457): this is the first TS source that
 * imports a sibling TS-migrated module. The import specifier uses the .cjs
 * extension per nodenext convention; tsc resolves it to src/runtime-name-policy.cts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeRuntimeName, resolveRuntimeNameFromCandidates } from './runtime-name-policy.cjs';

export function formatGsdSlash(commandName: unknown, runtime: unknown): unknown {
  if (typeof commandName !== 'string') return commandName;
  if (commandName === '') return commandName;

  // Strip any existing leading prefix so the helper is idempotent and accepts
  // both legacy `/gsd:<name>` and canonical hyphen-form input (plus the bare
  // `gsd:<name>` shorthand and codex `$gsd-<name>` shell-var input).
  const stripped = commandName.replace(/^[/$]?gsd[-:]/i, '');
  // If the regex matched nothing (no prefix), the input is already a bare name.
  const bare = stripped === commandName ? commandName : stripped;
  // Defensive: a degenerate input like `/gsd:`, `gsd-`, or whitespace-only
  // normalizes to empty. Returning the original colon-form would re-emit the
  // deprecated shape that this module exists to suppress (#3584). Return an
  // empty string so callers see "no command" rather than the broken input.
  if (bare === '' || bare.trim() === '') return '';

  // Split on the first whitespace so only the command token is rewritten —
  // anything after the first space is caller-supplied arguments (phase
  // numbers, --flags, --paths C:\\Users\\Me, etc.) that must round-trip
  // untouched. Codex lowercases only the command token; preserving the
  // argument tail prevents path/flag corruption on case-sensitive systems.
  const wsMatch = bare.match(/^(\S+)(\s[\s\S]*)?$/);
  const token = wsMatch ? wsMatch[1] : bare;
  const tail = wsMatch && wsMatch[2] ? wsMatch[2] : '';

  const runtimeText = (typeof runtime === 'string' && runtime ? runtime : 'omp').toLowerCase();
  const rt = canonicalizeRuntimeName(runtimeText) || runtimeText;

  // Descriptor-driven: look up commandStyle from the capability registry.
  // Mirrors the lazy-require pattern from runtime-homes.cts §getGlobalConfigDir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runtimes } = require('./capability-registry.cjs') as {
    runtimes: Record<string, { runtime?: { commandStyle?: string } }>;
  };
  const style = runtimes[rt]?.runtime?.commandStyle;

  if (style === 'shell-var') {
    // shell-var runtimes (currently: codex) use $gsd-<cmd> syntax. The command
    // token is lowercased because shell-var identifiers are conventionally
    // lowercase; matches the convertCodexSlash() projection in bin/install.js.
    return `$gsd-${token.toLowerCase()}${tail}`;
  }
  return `/gsd-${token}${tail}`;
}

/**
 * Resolve the effective runtime for a project directory.
 *
 *   process.env.GSD_RUNTIME  >  config.runtime  >  'claude'
 *
 * Mirrors the precedence already used by profile-output.cjs and the rest of
 * the runtime resolution chain. Returns a lowercased string so downstream
 * comparisons can be case-blind.
 *
 * @param projectDir - path to the project directory, or null/undefined
 * @returns the resolved runtime name
 */
export function resolveRuntime(projectDir: string | null | undefined): string {
  const envRuntime = resolveRuntimeNameFromCandidates(process.env['GSD_RUNTIME']);
  if (envRuntime) {
    if (envRuntime !== 'omp') {
      throw new Error(`this GSD fork supports OMP only (got: ${envRuntime})`);
    }
    return envRuntime;
  }
  if (projectDir) {
    try {
      // Read config.json directly (not via loadConfig). loadConfig has a side
      // effect of normalizing and re-writing legacy keys back to disk, which
      // would mutate the project file just to read the runtime name. We only
      // need the literal `runtime:` value, so a plain JSON read is sufficient
      // and side-effect-free.
      const configPath = path.join(projectDir, '.planning', 'config.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'runtime' in parsed) {
          const configRuntime = resolveRuntimeNameFromCandidates((parsed as Record<string, unknown>)['runtime']);
          if (configRuntime) {
            if (configRuntime !== 'omp') {
              throw new Error(`this GSD fork supports OMP only (got: ${configRuntime})`);
            }
            return configRuntime;
          }
        }
      }
    } catch (e) {
      // Re-throw fail-loud errors; fall through to marker/default only for I/O errors.
      if (e instanceof Error && e.message.includes('this GSD fork supports OMP only')) {
        throw e;
      }
      // Fall through to marker/default — a missing/broken config must not crash
      // runtime output formatting.
    }
  }
  // Per-install .gsd-runtime marker: the installer writes this next to VERSION
  // at <install>/gsd-core/.gsd-runtime. For a local install, that's under
  // <projectDir>/.<dirName>/gsd-core/.gsd-runtime. This is the source of truth
  // for "which runtime owns THIS install" — config.json's runtime field can
  // drift (e.g. set to "pi" but the actual install is "omp"). Precedence
  // mirrors model-resolver.cts's resolveActiveRuntime.
  if (projectDir) {
    try {
      // Check the local install dir for the .gsd-runtime marker.
      const markerPath = path.join(projectDir, '.omp', 'gsd-core', '.gsd-runtime');
      if (fs.existsSync(markerPath)) {
        const raw = fs.readFileSync(markerPath, 'utf8').trim();
        const markerRuntime = resolveRuntimeNameFromCandidates(raw);
        if (markerRuntime) {
          if (markerRuntime !== 'omp') {
            throw new Error(
              `this GSD fork supports OMP only (got: ${markerRuntime})`
            );
          }
          return markerRuntime;
        }
      }
    } catch (e) {
      // Re-throw fail-loud errors; fall through to default only for I/O errors.
      if (e instanceof Error && e.message.includes('this GSD fork supports OMP only')) {
        throw e;
      }
      // Fall through to default
    }
  }
  return 'omp';
}
/**
 * Convenience: format using the runtime resolved from a project directory.
 * Equivalent to `formatGsdSlash(name, resolveRuntime(projectDir))`.
 */
export function formatGsdSlashFor(projectDir: string | null | undefined, commandName: unknown): unknown {
  return formatGsdSlash(commandName, resolveRuntime(projectDir));
}
