# Scan and explain

`scan` and `explain` sample processes, memory, listening TCP ports, and Docker for the sampling window, then print a local report. They never execute anything and, without `--send-llm`, make no network request. On a TTY the report is text; when stdout is not a TTY, or with `--json`, it is a JSON report.

## Sub-features

- `scan-json` prints a schema-versioned JSON report with machine, process, port, Docker, and candidate fields.
- `scan-human` prints the text report (`Otter local snapshot`) on a TTY.
- `scan-explain` runs `explain`, which is the same local report in explain mode.
- `scan-window` validates `--window` (integer 0 through 10).
- `scan-docker` reports Docker availability and counts disposable containers as candidates.
- `scan-noexec` always reports execution as not available.

## How to get to it (user POV)

- Run `otter scan` in a terminal (text) or piped (JSON).
- Run `otter scan --json`, `otter scan --local-only`, `otter explain`.
- Run `otter scan --window <seconds>`.

## Driving it with control-otter

Preconditions: `$C doctor` exits 0. Docker is running. For `scan-docker`, `$C fixture up` was run.

- **JSON report.** Run `$C run scan json -- scan --json --window 1`. Exit code `0`. Stdout parses as JSON with `"schemaVersion": "1.0-local"`, `"mode": "local"`, and `collectorStatus` listing `machine`, `memory`, `process`, `ports`, `docker`, each `complete`.
- **Piped output is JSON without the flag.** Run `$C run scan piped -- scan --window 1`. Stdout is the same JSON shape.
- **Human report.** Run `$C tty start -- scan --window 1`, then `$C tty wait "OTTER_EXIT=" 60`, then `$C tty screen > .agents/skills/verify-otter/evidence/$OTTER_VERIFY_RUN/scan/human.screen.txt` (create the directory first with `mkdir -p`). The screen has the lines `Otter local snapshot`, `Top processes`, `listening TCP ports`, `Docker available true`, and ends with `OTTER_EXIT=0`. Then `$C tty stop`.
- **Explain.** Run `$C run scan explain -- explain --json --window 1`. Exit `0`, `execution.status` is `not_available`.
- **Docker candidate.** With the fixture up, run `$C run scan docker -- scan --json --window 1` and read `docker.disposableCandidates`. It is `1`, and `validatedCandidates` contains one entry with `"kind": "container"`, `"eligibility": "eligible"`. `$C note scan docker-ps -- docker ps --filter label=otter.disposable=true --format '{{.Names}}'` shows the same container as the second view.
- **No execution.** In the same JSON, `execution.status` is `not_available` and `execution.results` is empty.
- **Window validation.** Run `$C run scan window-bad -- scan --window 11`. Exit code `1` (commander rejects it), stderr says `must be an integer from 0 through 10`, and no new trace file is written (`$C run trace list -- trace list` count is unchanged).
- **Proof.** The saved `scan/json.txt`, `scan/docker.txt`, and `scan/human.screen.txt`.

## Gotchas

- Without `--json`, a pipe still yields JSON. Only a real PTY gives the text report. `$C run` is never a PTY.
- `--local-only` is accepted and is the default behavior. It cannot be combined with `--send-llm` (exit `2`).
- Exit code is `1` when any collector is `failed` or `denied`. A `skipped` Docker collector (daemon down) does not change the exit code; `docker.available` is then `false`.
- Docker collection takes about 5 seconds regardless of `--window`, so a run takes at least that long.
- Each scan writes a trace file, so scans change the trace list. The disposable-container candidate count only means anything with `fixture up`.
- Container names are not in the JSON report (the redacted payload hashes them). Use the `clean` prompt or `docker ps` to identify a container.
