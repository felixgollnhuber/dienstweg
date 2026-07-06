# Security

## Threat model: a guardrail, not a sandbox

The `branch-guard` hook exists to stop **honest mistakes** — an agent force-pushing to `main`, opening a PR against the wrong base, bypassing commit hooks with `-n`. It parses the command an agent is about to run and blocks the everyday dangerous forms.

It is **not** a security boundary. A determined actor (or a sufficiently creative agent) can always bypass it through obfuscation — nested command substitution, base64, a script file. If you need to *contain* a hostile process, use an actual sandbox (containers, restricted credentials, protected branches on the server side). Server-side branch protection is the enforcement layer; branch-guard is the seatbelt in front of it.

Bypass reports are still welcome (see below) when they concern **realistic agent-emitted forms** — command shapes an agent plausibly produces by accident. "I base64-encoded the push" is out of scope by design.

## Update trust model

`dienstweg init` and `dienstweg update` write an executable hook (`.claude/hooks/branch-guard.mjs`, `.codex/hooks/branch-guard.mjs`) into adopting repos and wire it into the harness settings. That hook then runs on every Bash tool call for everyone using the repo. You should know what you are trusting:

- The hook is **generated from this package** — the exact code is [templates/hooks/branch-guard.mjs](templates/hooks/branch-guard.mjs), ~250 lines, reviewable in one sitting.
- It makes **no network calls** and executes **nothing from the target repo**. Its only I/O: it reads the hook payload from stdin and locates `dienstweg.config.json` by walking up parent directories.
- Generated files are hash-tracked in `.dienstweg/manifest.json`; `dienstweg check` flags any file that no longer matches what the tool generated.
- Releases are published to npm from CI with [provenance attestation](https://docs.npmjs.com/generating-provenance-statements), so you can verify the tarball was built from the tagged source of this repository.

You can self-test the installed guard at any time:

```bash
echo '{"tool_input":{"command":"git push --force origin main"},"cwd":"."}' \
  | node .claude/hooks/branch-guard.mjs; echo "exit: $?"   # expect: BLOCKED, exit 2
```

Note the guard **fails open** by design: on an empty or unparseable payload it allows the command, so a future harness payload change disables it silently rather than breaking your workflow. If the self-test above stops exiting 2, please open an issue.

## Reporting a vulnerability

Please report security-relevant issues via [GitHub private vulnerability reporting](https://github.com/felixgollnhuber/dienstweg/security/advisories/new) rather than a public issue. You should get a response within a week. Realistic-bypass reports, hook-injection concerns, and supply-chain questions all qualify.
