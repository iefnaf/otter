# Otter verification map

This directory is the maintained source for verifying the user-facing behavior of Otter. Read this index, then the matching feature file.

## Baseline preconditions

- macOS host, `bun`, `tmux` on `PATH`. Docker Desktop running for the container parts of `clean` and for Docker fields in `scan`.
- Run from the repo root with `C=.agents/skills/verify-otter/scripts/control-otter`.
- `$C launch` done and `OTTER_VERIFY_RUN` exported. `$C doctor` exits 0. The sandbox starts with no settings file and no traces.
- Never drive a run that this verification did not start. Never touch the real `~/.otter`.

## Driving conventions

- Always pass `--window 1`.
- Non-interactive commands: `$C run <feature> <label> -- <otter args>`. Output is JSON for `scan`, `explain`, and `clean` because stdout is a pipe.
- Human-rendered reports and `clean` prompts: `$C tty ...` (real PTY). Wait for literal strings, not fixed sleeps.
- `clean` prompts are answered with `$C tty drive-clean`. Real machine processes get `n`. Only the fixture container is ever approved.
- Candidate IDs (`cand_...`) and run IDs change on every run. Match on kind, action, and eligibility, not IDs.
- Start each feature from the state its preconditions name. Settings persist in the sandbox between features, so reset with `config set-execution disabled` and `config set-model gpt-4o-mini` when a recipe says so.

## Proof and skip reporting

- Every recipe ends in an observable artifact under `evidence/<id>/<feature>/`.
- CLI proof includes the command, stdout, stderr, and exit code (`$C run` saves all four).
- Mutation proof (settings, containers, traces) includes a second view from `$C note`, `$C fixture state`, or `trace show`.
- Record the feature ID and entry point in the label.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a skipped path as verified through another path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then these H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-otter`, `Gotchas`.

## Features

- [Scan and explain](./scan.md) covers the local snapshot in JSON and human form, option validation, and exit codes.
- [Payload preview and analyzer gate](./payload-privacy.md) covers `--preview-payload`, redaction, and the no-network default for `--send-llm`.
- [Configuration](./config.md) covers `config show`, `set-model`, `set-execution`, validation, and the settings file.
- [Traces](./trace.md) covers `trace list|show|export`, event order, private modes, and argument redaction.
- [Guarded cleanup](./clean.md) covers every execution gate, the interactive confirmation, decline, and approve of a disposable container.
