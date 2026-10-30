# Otter

Otter is a macOS resource diagnostic CLI with guarded cleanup. It samples processes, memory, listening TCP ports, and Docker state, keeps the raw snapshot in memory, and writes only a redacted projection to local traces.

## Status

Execution is disabled by default. Only `clean` can execute, and only when all of these conditions are true:

- `enableExecution` is `true` in settings.
- The output is an interactive terminal, not JSON.
- The candidate passes the local safety predicate.
- You approve that exact candidate.
- Otter can write its confirmation to the local audit trace.

`scan`, `explain`, `--local-only`, and `--json` never execute. There is no consent-skipping flag.

The analyzer is deny-by-default. Without `--send-llm`, Otter makes no network request. With `--send-llm`, Otter sends only the projected payload shown by `--preview-payload`. Model output may contain findings and opinions about locally generated candidate IDs. It cannot contain recommendations, commands, target references, risk levels, or expected savings.

Local rules own execution. A process must be owned by the current user, listen on a port, have no terminal, run for more than eight hours, use less than 1 percent CPU, have no active children, and not appear in `launchctl list`. A container must carry `otter.disposable=true`, be running or paused, be healthy or have no health check, use less than 2 percent CPU, and use a `no` or `on-failure` restart policy. Otter revalidates the process or Docker inspection immediately before every action and checks process identity again before SIGKILL.

## Design documents

The current design draft and review history are in [docs/design](design/README.md).

## Use

```bash
bun install
bun run dev --help
bun run dev scan --local-only
bun run dev scan --preview-payload
bun run dev scan --send-llm
bun run dev clean
```

Enable cleanup execution:

```bash
bun run dev config set-execution enabled
```

Otter supports `gpt-4o-mini` and `deepseek-v4-flash`. Select the model with `config set-model`. For DeepSeek, export `DEEPSEEK_API_KEY`. For OpenAI, export `OPENAI_API_KEY`. Otter also reads an API key from macOS Keychain:

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
