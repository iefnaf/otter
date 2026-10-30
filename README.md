# Otter

Otter is a read-only macOS resource diagnostic CLI. It samples processes, memory, listening TCP ports, and Docker state, keeps the raw snapshot in memory, and writes only a redacted projection to local traces.

## Status

This is the v0.1 safety slice. Otter never executes cleanup commands. `scan`, `explain`, and `clean` produce local reports by default. `clean` only reports opaque candidates and states that execution is disabled.

The analyzer is deny-by-default. Without `--send-llm`, Otter makes no network request. With `--send-llm`, Otter sends only the projected payload shown by `--preview-payload`. Model output may contain findings and opinions about locally generated candidate IDs. It cannot contain recommendations, commands, target references, risk levels, or expected savings.

## Use

```bash
bun install
bun run dev --help
bun run dev scan --local-only
bun run dev scan --preview-payload
bun run dev scan --send-llm
```

Set an OpenAI-compatible API key in macOS Keychain:

```bash
bun run dev config set-api-key
```

Inspect local traces:

```bash
bun run dev trace list
bun run dev trace show <run-id>
bun run dev trace export <run-id>
```

## Verify

```bash
bun run verify
```

The check runs tests, TypeScript validation, the compiled binary build, and `otter --help`.
