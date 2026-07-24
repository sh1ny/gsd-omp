# Pending multi-runtime doc cleanup

This fork has been made OMP-only (see `.changeset/omp-only-runtime-removal.md`).
The code, tests, CI, and install paths are fully OMP-native. The following
documentation and prose still reference removed runtimes and is deferred for
cleanup per the owner's code-first decision:

## Deferred cleanup items

- **`CONTEXT.md`** — references removed runtimes, `teams-status`, opencode/kilo/antigravity permission writers, and the `ide` host-integration profile.
- **`CHANGELOG.md`** — kept verbatim as historical record; no edits.
- **`docs/**`** — prose throughout still references removed runtimes, the `ide` profile, `sandboxed-web`, MCP transport, `gsd-mcp-server`, `hooks/`, and per-harness packaging. The generated `docs/reference/capability-matrix.md` and `gsd-core/bin/lib/capability-registry.cjs` are already regenerated (OMP-only). ADRs (notably 1239, 1016, 1244, 3660, 1508, 766) retain multi-runtime narrative as design history.
- **`docs/registries/`** — community registry files intentionally left (community-contributed, not GSD-controlled).
- **Translated `README.*.md`** — still reference removed runtimes.
- **`docs/INVENTORY.md`** (all 5 language variants) — inventory entries for deleted modules (`mcp-server.cjs`, `teams-status.cjs`, `runtime-hooks-surface.cjs`, `claude-orchestration*.cjs`) and packaging dirs still listed.
- **`.gitignore`** — entries for deleted compiled outputs (`/gsd-core/bin/lib/teams-status.cjs`, `/gsd-core/bin/lib/mcp-server.cjs`, `/gsd-core/bin/lib/runtime-hooks-surface.cjs`) still present (harmless — files no longer exist).
- **`eslint.config.mjs`** — source-mirror entries for deleted modules still present.

## Already done (code-first)

- All 20 capability descriptor directories for removed runtimes deleted (Phase A).
- All packaging/payload trees deleted (Phase B).
- All `src/*.cts` modules pruned to OMP-only (Phase C).
- `bin/install.js` pruned to OMP-only (Phase D).
- `package.json` updated — deps, bin, files, scripts (Phase E).
- All runtime-exclusive test files deleted, surviving tests pruned (Phase F).
- CI workflows and scripts updated (Phase G).
- Runtime-specific changesets deleted; OMP-only changeset created (Phase H).
- Generated artifacts regenerated: `capability-registry.cjs`, `capability-matrix.md`.
