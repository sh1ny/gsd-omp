# AGENTS.md

Operating rules for all agents working in this repository.

## Remotes

This repository has two remotes:

- `origin` → `sh1ny/gsd-omp` — **the fork we work against.**
- `upstream` → `open-gsd/gsd-core` — read-only reference. **Never modified.**

## Remote policy

- **NEVER touch `upstream`.** Do not push to it, do not open PRs against it, do not open issues on it, do not modify anything on `upstream` — unless the owner explicitly requests it in the current conversation.
- **We ONLY work with `origin`.** Every push, PR, branch operation, and GitHub API action targets `origin` (`sh1ny/gsd-omp`).
- **ALL local branches track `origin`, never `upstream`.** Do not set any local branch's upstream to an `upstream/*` ref. If you find a local branch tracking `upstream/*`, re-point it to the corresponding `origin/*` ref.
- `upstream` is fetched for reference/merging only. Treat it as strictly read-only.
