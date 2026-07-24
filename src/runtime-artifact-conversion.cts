/* eslint-disable @typescript-eslint/ban-ts-comment,
                  @typescript-eslint/no-require-imports,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-unsafe-argument */
// Mechanical extraction from bin/install.js; keep behavior parity before typing.
// @ts-nocheck
'use strict';
/**
 * Runtime Artifact Conversion Module.
 *
 * First slice: layout-reached command/skill artifact converters moved out of
 * bin/install.js so Runtime Artifact Layout no longer reaches through the
 * Installer Module for conversion behavior.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import commandRoster = require('./command-roster.cjs');
const { readGsdCommandNames, transformContentToHyphen } = commandRoster;
import runtimeNamePolicy = require('./runtime-name-policy.cjs');
const { getDirName } = runtimeNamePolicy;
import capabilityRegistry = require('./capability-registry.cjs');
import { posixNormalize } from './shell-command-projection.cjs';

/**
 * Host-specific install behaviors declared on the runtime descriptor
 * (capabilities/<runtime>/capability.json -> runtime.hostBehaviors). Mirrors
 * bin/install.js's / install-engine.cts's `_hostBehaviors` (ADR-1239 / #2086
 * / #2092). Returns {} for runtimes that declare none, so every behavior
 * branch degrades to the generic path by default. The module already imports
 * `capabilityRegistry` statically, so this reads it directly rather than
 * re-require()-ing inside a try/catch.
 */
function _hostBehaviors(runtime: string): Record<string, unknown> {
  return (
    (capabilityRegistry &&
      capabilityRegistry.runtimes &&
      capabilityRegistry.runtimes[runtime] &&
      capabilityRegistry.runtimes[runtime].runtime &&
      capabilityRegistry.runtimes[runtime].runtime.hostBehaviors) ||
    {}
  );
}

/**
 * Public accessor for the `hostBehaviors.agentFileExtension` descriptor field
 * (ADR-1239 / #2099 / #2103). Returns the runtime's declared agent-file
 * destination-suffix rename target, or `undefined` when the runtime declares
 * none. Exported so callers outside this module (surface.cts's `_syncGsdDir`)
 * can derive the same rename decision as install-engine.cts's staged-copy
 * loop from ONE descriptor read. For OMP the descriptor declares no
 * `agentFileExtension`, so this always returns undefined — the accessor
 * remains so the descriptor-driven contract is upheld.
 */
function agentFileExtensionFor(runtime: string): string | undefined {
  const ext = _hostBehaviors(runtime).agentFileExtension;
  return typeof ext === 'string' ? ext : undefined;
}


function normalizeClaudeSkillEffort(effort) {
  return effort === 'xhigh' ? 'max' : effort;
}

function toSingleLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function yamlIdentifier(value) {
  const text = String(value).trim();
  if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(text)) {
    return text;
  }
  return yamlQuote(text);
}

function extractFrontmatterAndBody(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: content.substring(3, endIndex).trim(),
    body: content.substring(endIndex + 3),
  };
}

function extractFrontmatterField(frontmatter, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

// ── OMP converters ──────────────────────────────────────────────────────────

function convertSlashCommandsToOmpMentions(content) {
  return content
    .replace(/\/gsd:([a-z0-9-]+)/gi, (_, commandName) => `/gsd-${commandName}`)
    .replace(/\bgsd:([a-z0-9-]+)/gi, (_, commandName) => `gsd-${commandName}`);
}

function convertClaudeToOmpMarkdown(markdown) {
  let converted = convertSlashCommandsToOmpMentions(markdown);
  converted = converted.replace(/\bAskUserQuestion\b/g, 'Ask');
  converted = converted.replace(/\$ARGUMENTS\b/g, '{{GSD_ARGS}}');
  converted = converted.replace(/`\.\/CLAUDE\.md`/g, '`AGENTS.md`');
  converted = converted.replace(/~\/\.claude\//g, '.omp/');
  converted = converted.replace(/\$HOME\/\.claude\//g, '.omp/');
  converted = converted.replace(/\$env:USERPROFILE\/\.claude\//g, '.omp/');
  converted = converted.replace(/\$env:USERPROFILE\\\.claude\\/g, '.omp/');
  converted = converted.replace(/~\/\.claude\b/g, '.omp');
  converted = converted.replace(/\$HOME\/\.claude\b/g, '.omp');
  converted = converted.replace(/\$env:USERPROFILE\/\.claude\b/g, '.omp');
  converted = converted.replace(/\$env:USERPROFILE\\\.claude\b/g, '.omp');
  converted = converted.replace(/\.\/CLAUDE\.md/g, 'AGENTS.md');
  converted = converted.replace(/`CLAUDE\.md`/g, '`AGENTS.md`');
  converted = converted.replace(/\bCLAUDE\.md\b/g, 'AGENTS.md');
  converted = converted.replace(/\.claude\/skills\//g, '.omp/skills/');
  converted = converted.replace(/\.\/\.claude\//g, './.omp/');
  converted = converted.replace(/\.claude\//g, '.omp/');
  converted = converted.replace(/\*\*Known Claude Code bug \(classifyHandoffIfNeeded\):\*\*[^\n]*\n/g, '');
  converted = converted.replace(/- \*\*classifyHandoffIfNeeded false failure:\*\*[^\n]*\n/g, '');
  converted = converted.replace(/\bClaude Code\b/g, 'OMP');
  return converted;
}

const OMP_MODEL_ROLES = new Set(['default', 'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'task']);

function normalizeOmpModelOverride(modelOverride) {
  if (typeof modelOverride !== 'string') return '';
  const trimmed = modelOverride.trim();
  if (!trimmed) return '';
  const colon = trimmed.indexOf(':');
  const head = colon === -1 ? trimmed : trimmed.slice(0, colon);
  if (OMP_MODEL_ROLES.has(head)) return `pi/${trimmed}`;
  return trimmed;
}

function convertClaudeCommandToOmpCommand(content, commandName) {
  const converted = convertClaudeToOmpMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  if (!frontmatter) return converted;

  const description = extractFrontmatterField(frontmatter, 'description') || `Run GSD workflow ${commandName}.`;
  const argumentHint = extractFrontmatterField(frontmatter, 'argument-hint');
  const effort = extractFrontmatterField(frontmatter, 'effort');

  let fm = `---\nname: ${yamlIdentifier(commandName)}\ndescription: ${yamlQuote(toSingleLine(description))}\n`;
  if (argumentHint) fm += `argument-hint: ${yamlQuote(argumentHint)}\n`;
  if (effort) fm += `effort: ${normalizeClaudeSkillEffort(effort)}\n`;
  fm += '---';
  return `${fm}\n${body}`;
}

function convertClaudeCommandToOmpSkill(content, skillName) {
  const converted = convertClaudeToOmpMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  if (!frontmatter) return converted;

  const description = extractFrontmatterField(frontmatter, 'description') || `Run GSD workflow ${skillName}.`;
  const argumentHint = extractFrontmatterField(frontmatter, 'argument-hint');
  const effort = extractFrontmatterField(frontmatter, 'effort');

  let fm = `---\nname: ${yamlIdentifier(skillName)}\ndescription: ${yamlQuote(toSingleLine(description))}\n`;
  if (argumentHint) fm += `argument-hint: ${yamlQuote(argumentHint)}\n`;
  if (effort) fm += `effort: ${normalizeClaudeSkillEffort(effort)}\n`;
  fm += '---';
  return `${fm}\n${body}`;
}

// The 2nd positional is the per-agent model override (string|null) threaded by
// the install.js agents loop; the descriptor-driven convertedAgentsKind path
// invokes (content, isGlobal) — a boolean normalizes to '' (no model line).
function convertClaudeAgentToOmpAgent(content, modelOverride = null) {
  const converted = convertClaudeToOmpMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  if (!frontmatter) return converted;

  const name = extractFrontmatterField(frontmatter, 'name') || 'unknown';
  const description = extractFrontmatterField(frontmatter, 'description') || '';
  const toolsRaw = extractFrontmatterField(frontmatter, 'tools') || '';
  const tools = toolsRaw.split(',').map((tool) => tool.trim()).filter(Boolean);

  let fm = `---\nname: ${yamlIdentifier(name)}\ndescription: ${yamlQuote(toSingleLine(description))}\n`;
  const normalizedModelOverride = normalizeOmpModelOverride(modelOverride);
  if (normalizedModelOverride) fm += `model: ${yamlQuote(normalizedModelOverride)}\n`;
  if (tools.length > 0) fm += `tools: ${tools.join(', ')}\n`;
  fm += '---';
  return `${fm}\n${body}`;
}

// ── Rewrite engine — ADR-1508 Phase 2 ───────────────────────────────────────

// Relocated from bin/install.js (#1511). Behavior is byte-for-behavior identical
// to the originals; the only change is the injected `attribution` 5th param in
// _applyRuntimeRewrites (replacing the internal getCommitAttribution() call).

/**
 * Compute the path prefix for a runtime install.
 * Global installs under $HOME use $HOME/... form; others use the resolved target.
 *
 * @private — exported as `_computePathPrefix` for tests.
 */
function computePathPrefix({ isGlobal, isWindowsHost: _isWindowsHost, resolvedTarget, homeDir }) {
  // #1615: normalize Windows backslashes to forward slashes. This prefix is
  const posixTarget = posixNormalize(String(resolvedTarget));
  const posixHome = homeDir ? posixNormalize(String(homeDir)) : homeDir;
  if (isGlobal && posixTarget.startsWith(posixHome)) {
    return '$HOME' + posixTarget.slice(posixHome.length) + '/';
  }
  return `${posixTarget}/`;
}

/**
 * Apply the per-runtime rewrite table to a single content string.
 * Relocated from bin/install.js `_applyRuntimeRewrites`.
 *
 * The 5th `attribution` param replaces the internal getCommitAttribution() call
 * so the function is pure (no config I/O). Pass the resolved attribution value
 * from the installer; pass `undefined` to leave Co-Authored-By lines untouched.
 *
 * This fork ships OMP only — the multi-runtime switch collapsed to a single
 * `'omp'` arm that performs the path-prefix rewrites, the AskUserQuestion→
 * Ask tool rename, and the attribution pass.
 *
 * @private — exported as `_applyRuntimeRewrites` for tests.
 */
function _applyRuntimeRewrites(content, runtime, pathPrefix, isGlobal = false, attribution = undefined) {
  const dirName = getDirName(runtime);
  const normalizedPathPrefix = pathPrefix.replace(/\/$/, '');

  switch (runtime) {
    case 'omp':
      content = content.replace(/~\/\.claude\//g, pathPrefix);
      content = content.replace(/\$HOME\/\.claude\//g, pathPrefix);
      content = content.replace(/\.\/\.claude\//g, `./${dirName}/`);
      content = content.replace(/~\/\.claude\b/g, normalizedPathPrefix);
      content = content.replace(/\$HOME\/\.claude\b/g, normalizedPathPrefix);
      content = content.replace(/\.\/\.claude\b/g, `./${dirName}`);
      content = content.replace(/~\/\.omp\/agent\//g, pathPrefix);
      content = content.replace(/\$HOME\/\.omp\/agent\//g, pathPrefix);
      // Global-scope only (fork's rewriteRuntimeDir gate — passed as isGlobal):
      // redirect .omp/ self-references to the resolved global agent home.
      if (isGlobal) {
        content = content.replace(/\.\/\.omp\//g, pathPrefix);
        content = content.replace(/(?<![A-Za-z0-9_.\-/~$])\.omp\//g, pathPrefix);
        content = content.replace(/\.\/\.omp\b/g, normalizedPathPrefix);
        content = content.replace(/(?<![A-Za-z0-9_.\-/~$])\.omp\b/g, normalizedPathPrefix);
      }
      content = content.replace(/\bAskUserQuestion\b/g, 'Ask');
      content = processAttribution(content, attribution);
      break;

    default:
      // Unknown runtime — no rewrites. The OMP-only contract raises a hard
      // error at resolveRuntime time, so reaching this branch indicates a
      // configuration bug rather than a real install.
      break;
  }

  return content;
}

/**
 * LOW-LEVEL: In-place fs walk: rewrite all .md files under stagedDir.
 *
 * pathPrefix and attribution are passed in (already resolved by the caller).
 * Single owner of the walk loop — both the high-level rewriteStagedSkillBodies
 * and the install.js compat wrapper delegate here.
 *
 * @param stagedDir    directory of staged skill/agent files
 * @param runtime      canonical runtime ID
 * @param pathPrefix   trailing-slash path prefix (e.g. '$HOME/.cursor/')
 * @param isGlobal     true for global scope installs
 * @param attribution  Co-Authored-By value (string | null | undefined)
 */
function applyRuntimeContentRewritesInPlace(stagedDir, runtime, pathPrefix, isGlobal = false, attribution = undefined) {
  if (!fs.existsSync(stagedDir)) return;

  const walkAndRewrite = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndRewrite(fullPath);
      } else if (entry.name.endsWith('.md')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        content = _applyRuntimeRewrites(content, runtime, pathPrefix, isGlobal, attribution);
        fs.writeFileSync(fullPath, content);
      }
    }
  };
  walkAndRewrite(stagedDir);
}

/**
 * LOW-LEVEL: Copy-to-temp then rewrite all .md files.
 *
 * pathPrefix and attribution are passed in (already resolved by the caller).
 * Single owner of the copy+rewrite loop — both the high-level
 * rewriteStagedCommandBodies and the install.js compat wrapper delegate here.
 *
 * IMPORTANT: always copies to a fresh mkdtemp dir — never mutates the source dir
 * (stageSkillsForProfile returns the source dir on full profile; mutation would
 * corrupt the package source).
 *
 * @param stagedDir    directory of staged flat .md command files
 * @param runtime      canonical runtime ID
 * @param pathPrefix   trailing-slash path prefix
 * @param isGlobal     true for global scope installs
 * @param attribution  Co-Authored-By value (string | null | undefined)
 * @returns {string} path to the temp dir (caller is responsible for cleanup)
 */
function applyRuntimeContentRewritesForCommandsInPlace(stagedDir, runtime, pathPrefix, isGlobal = false, attribution = undefined) {
  if (!fs.existsSync(stagedDir)) return stagedDir;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cmd-rewrites-'));
  try {
    for (const entry of fs.readdirSync(stagedDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      let content = fs.readFileSync(path.join(stagedDir, entry.name), 'utf8');
      content = _applyRuntimeRewrites(content, runtime, pathPrefix, isGlobal, attribution);
      fs.writeFileSync(path.join(tempDir, entry.name), content);
    }
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    throw err;
  }
  return tempDir;
}

/**
 * HIGH-LEVEL: In-place fs walk: rewrite all .md files under stagedDir for the given runtime.
 *
 * Deep public seam (ADR-1508 Phase 2). Derives resolvedTarget/homeDir/isGlobal/pathPrefix/
 * attribution from opts, then delegates to applyRuntimeContentRewritesInPlace (single walk owner).
 *
 * @param stagedDir   directory of staged skill/agent files
 * @param opts.runtime          canonical runtime ID
 * @param opts.configDir        runtime config directory (absolute path)
 * @param opts.scope            'global' | 'local'
 * @param opts.homedir          optional homedir resolver (injectable for tests; defaults to os.homedir)
 * @param opts.platform         optional platform string (injectable for tests; defaults to process.platform)
 * @param opts.resolveAttribution  optional fn(runtime)→string|null|undefined; called once per invocation
 */
function rewriteStagedSkillBodies(stagedDir, opts) {
  const {
    runtime,
    configDir,
    scope = 'global',
    homedir = () => os.homedir(),
    platform = process.platform,
    resolveAttribution,
  } = opts;
  if (!fs.existsSync(stagedDir)) return;

  const resolvedTarget = posixNormalize(path.resolve(configDir));
  const homeDir = posixNormalize(homedir());
  const isGlobal = scope === 'global';
  const isWindowsHost = platform === 'win32';
  const pathPrefix = computePathPrefix({ isGlobal, isWindowsHost, resolvedTarget, homeDir });
  const attribution = resolveAttribution ? resolveAttribution(runtime) : undefined;

  applyRuntimeContentRewritesInPlace(stagedDir, runtime, pathPrefix, isGlobal, attribution);
}

/**
 * HIGH-LEVEL: Copy-to-temp then rewrite all .md files for the given runtime.
 *
 * Deep public seam (ADR-1508 Phase 2). Derives resolvedTarget/homeDir/isGlobal/pathPrefix/
 * attribution from opts, then delegates to applyRuntimeContentRewritesForCommandsInPlace
 * (single copy+rewrite owner).
 *
 * @internal — symmetric companion to rewriteStagedSkillBodies; the deep-seam API for
 * command bodies. Production callers: applySurface (surface.cts) and the install path
 * in createRuntimeArtifactInstallPlan (runtime-artifact-install-plan.cts) — both keep
 * the returned temp dir alive until they have copied its contents out, then clean it up
 * in their own finally. (A test that treats this as a throwaway shared-tmp path will
 * race those live temp dirs under --test-concurrency; see #1575/#2090.)
 *
 * @returns {string} path to the temp dir (caller is responsible for cleanup)
 */
function rewriteStagedCommandBodies(stagedDir, opts) {
  const {
    runtime,
    configDir,
    scope = 'global',
    homedir = () => os.homedir(),
    platform = process.platform,
    resolveAttribution,
  } = opts;
  if (!fs.existsSync(stagedDir)) return stagedDir;

  const resolvedTarget = posixNormalize(path.resolve(configDir));
  const homeDir = posixNormalize(homedir());
  const isGlobal = scope === 'global';
  const isWindowsHost = platform === 'win32';
  const pathPrefix = computePathPrefix({ isGlobal, isWindowsHost, resolvedTarget, homeDir });
  const attribution = resolveAttribution ? resolveAttribution(runtime) : undefined;

  return applyRuntimeContentRewritesForCommandsInPlace(stagedDir, runtime, pathPrefix, isGlobal, attribution);
}

/**
 * Normalize `/gsd:<cmd>` colon refs in the agent body to `/gsd-<cmd>` for
 * runtimes that declare `runtime.hostBehaviors.hyphenNameAgentBody` on their
 * descriptor (claude / qwen / hermes use hyphen-`name:` frontmatter;
 * cursor/windsurf/etc self-convert and don't declare the flag). Descriptor-
 * driven (ADR-1239 / #2092) — folded from the hardcoded
 * `HYPHEN_NAME_AGENT_RUNTIMES` allow-list set. Mirrors the per-file call in
 * bin/install.js line 9370 / `shouldNormalizeHyphenNamespaceInAgentBody`.
 *
 * @param content   raw agent file content (post-converter)
 * @param runtime   canonical runtime ID
 * @param cmdNames  gsd command names from readGsdCommandNames()
 */
function normalizeAgentBodyForRuntime(content: string, runtime: string, cmdNames: string[]): string {
  if (_hostBehaviors(runtime).hyphenNameAgentBody !== true) return content;
  return transformContentToHyphen(content, cmdNames);
}

/**
 * Apply the 4 base `~/.claude/` path-prefix rewrites to a single agent content
 * string. Mirrors the inline agent loop in bin/install.js lines 9330-9340:
 *   ~/\.claude/ → pathPrefix
 *   $HOME/\.claude/ → pathPrefix
 *   ~/\.claude\b → normalizedPathPrefix
 *   $HOME/\.claude\b → normalizedPathPrefix
 *
 * Skipped for any runtime that declares `hostBehaviors.noPathRewrite`
 * (descriptor-driven, ADR-1239 / #2096 — folds the prior hardcoded
 * `runtime === 'antigravity'` literal; Antigravity does NOT do path rewrites
 * in the inline loop / #2103 — folds the prior hardcoded
 * `runtime === 'copilot'` literal onto the same descriptor field, since
 * copilot also skips these rewrites).

 * @param content     raw agent file content
 * @param runtime     canonical runtime ID
 * @param pathPrefix  trailing-slash path prefix (e.g. '$HOME/.cursor/')
 * @returns content with path-prefix rewrites applied (or unchanged for noPathRewrite runtimes, e.g. copilot)
 */
function applyAgentPathRewrites(content: string, runtime: string, pathPrefix: string): string {
  if (_hostBehaviors(runtime).noPathRewrite === true) return content;
  const normalizedPathPrefix = pathPrefix.replace(/\/$/, '');
  content = content.replace(/~\/\.claude\//g, pathPrefix);
  content = content.replace(/\$HOME\/\.claude\//g, pathPrefix);
  content = content.replace(/~\/\.claude\b/g, normalizedPathPrefix);
  content = content.replace(/\$HOME\/\.claude\b/g, normalizedPathPrefix);
  return content;
}

// ── End rewrite engine ────────────────────────────────────────────────────────

/**
 * Apply Co-Authored-By attribution policy to file content.
 *   - null      -> remove the Co-Authored-By line and its preceding blank line
 *   - undefined -> leave content unchanged
 *   - string    -> replace the value ($ escaped to block backreference injection)
 *
 * Pure content transform, relocated from bin/install.js per ADR-1508
 * (epic #1507, #1510 Phase 1). NOTE: getCommitAttribution stays in the
 * installer — it is impure install-time config I/O (reads runtime
 * settings.json, uses the install-time config-dir + cache), not a content
 * transform, so it does not belong behind this content-conversion seam.
 */
function processAttribution(
  content: string,
  attribution: string | null | undefined,
): string {
  if (attribution === null) {
    // Remove Co-Authored-By lines and the preceding blank line
    return content.replace(/(\r?\n){2}Co-Authored-By:.*$/gim, '');
  }
  if (attribution === undefined) {
    return content;
  }
  // Replace with custom attribution (escape $ to prevent backreference injection)
  const safeAttribution = attribution.replace(/\$/g, '$$$$');
  return content.replace(/Co-Authored-By:.*$/gim, `Co-Authored-By: ${safeAttribution}`);
}

export = {
  processAttribution,
  // #2103: public accessor for hostBehaviors.agentFileExtension, exported so
  // surface.cts's _syncGsdDir can derive the .agent.md rename from the SAME
  // descriptor read as install-engine.cts (folds a duplicated hardcoded
  // `runtime === 'copilot'` literal). For OMP the descriptor declares no
  // `agentFileExtension`, so this always returns undefined — the accessor
  // remains so the descriptor-driven contract is upheld.
  agentFileExtensionFor,
  yamlIdentifier,
  yamlQuote,
  toSingleLine,
  extractFrontmatterAndBody,
  extractFrontmatterField,
  // OMP converters — commands, skills, agents
  convertSlashCommandsToOmpMentions,
  convertClaudeToOmpMarkdown,
  convertClaudeCommandToOmpCommand,
  convertClaudeCommandToOmpSkill,
  convertClaudeAgentToOmpAgent,
  normalizeOmpModelOverride,
  OMP_MODEL_ROLES,
  normalizeClaudeSkillEffort,
  // Re-exports from command-roster for callers outside this module
  // (runtime-artifact-layout, install-profiles).
  readGsdCommandNames,
  transformContentToHyphen,
  // #1511 ADR-1508 Phase 2: rewrite engine deep seam
  // Low-level walkers (pathPrefix + attribution pre-resolved by caller):
  applyRuntimeContentRewritesInPlace,
  applyRuntimeContentRewritesForCommandsInPlace,
  // High-level wrappers (derive pathPrefix + attribution from opts):
  rewriteStagedSkillBodies,
  rewriteStagedCommandBodies,
  // ADR-1235 §1: descriptor-driven agent cross-cutting
  applyAgentPathRewrites,
  normalizeAgentBodyForRuntime,
  _computePathPrefix: computePathPrefix,
  _applyRuntimeRewrites,
};
