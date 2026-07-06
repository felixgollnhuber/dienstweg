# Contributing

Thanks for considering a contribution. dienstweg has a few unusual constraints — knowing them up front saves review rounds.

## Ground rules

- **Zero runtime dependencies.** The package installs executable code into other people's repos; every dependency is attack surface someone else inherits. PRs that add a runtime dependency will be declined — `node:` builtins only. (Dev-time: the test suite uses the built-in `node --test`, nothing else.)
- **Tool-owned files are a contract.** Everything dienstweg writes into adopting repos (commands, skills, hooks, the AGENTS block) is generic, reads `dienstweg.config.json` at runtime, and is tracked by content hash in `.dienstweg/manifest.json`. Never make a template repo-specific; customization goes through the config or `dienstweg.local.md`.
- **branch-guard changes need tests.** The guard's value is dozens of hand-hardened parsing edge cases (`-u origin main`, `HEAD:main`, `+main`, subshells, `-nm`, `--force-with-lease`, …). Any change to [templates/hooks/branch-guard.mjs](templates/hooks/branch-guard.mjs) must extend [tests/branch-guard.test.mjs](tests/branch-guard.test.mjs) with the new blocked/allowed forms.
- **Fail open, and honestly.** The guard allows on unparseable input by design, and the docs say plainly that it is a guardrail, not a sandbox. Don't add "security theater" — features that only stop attackers in the README.

## Workflow

1. Fork/branch — never commit to `main` directly (branch protection enforces this; so does the tool's own philosophy).
2. `npm test` must pass (Node ≥ 20).
3. Open a PR with a clear description of the behavior change.
4. Larger changes go through an ensemble review (multiple independent review passes) before merge — you'll see this in the PR history; it's the same convention the tool itself installs.

## Running the tests

```bash
npm test          # node --test, no dependencies
npm pack --dry-run  # verify the tarball stays clean
```

The integration tests create throwaway git repos under your temp directory and run the real CLI against them.

## Releases

Versions are semver git tags. Config schema changes ship as migrations in [migrations/index.mjs](migrations/index.mjs) so `dienstweg update` upgrades adopting repos in place — a schema change without a migration is a bug. Tags trigger the release workflow, which publishes to npm with provenance.
