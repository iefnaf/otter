---
name: verify-otter
description: Drive and prove Otter (macOS resource-diagnostic CLI with guarded cleanup) the way a user does - launch the compiled binary in a throwaway HOME, run scan/explain/clean/config/trace, answer the interactive clean confirmation in tmux against a disposable Docker container, and capture evidence. Use when a change to src/ needs proof beyond `bun test`, or when asked to verify an Otter feature end to end.
---

# Verify Otter

Otter is a CLI (`dist/otter`, built from `src/index.ts`). There is no server. Surfaces: a human report on a TTY, JSON when stdout is not a TTY, an interactive typed confirmation for `clean`, local trace files, and a settings file. Everything here runs on macOS only (`ps`, `lsof`, `vm_stat`, `launchctl`, `security`).

All driving goes through one helper. Set `C` once per shell:

```bash
C=.agents/skills/verify-otter/scripts/control-otter     # run from the repo root
```

The feature map in [features/README.md](features/README.md) is the recipe source. Read it and the matching feature file before driving. A proof that exercises one entry point is incomplete when the map lists others.

## Launch

```bash
$C launch                        # bun install (only if node_modules is missing), bun run build, new sandbox
export OTTER_VERIFY_RUN=<id printed on the last line>
```

`launch` creates `/tmp/otter-verify-<id>/home` and uses it as `HOME` for every otter invocation. Otter hardcodes `~/.otter`, so this keeps the real `~/.otter/settings.json` and `~/.otter/traces` untouched and starts from an empty data dir (no settings file, no traces). `DOCKER_CONFIG` still points at the real `~/.docker` so the Docker CLI finds its context. `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` are always unset. Ready means: the binary reports `0.1.0`, and `config show` in the sandbox reports `"enableExecution": false`.

There is nothing to keep alive. Each drive is a fresh process. Launch also records git HEAD, binary hash, and the real trace count in `evidence/<id>/launch.txt`.

Two instances may run side by side: each run has its own run id, sandbox dir, tmux socket (`otter-verify-<id>`), and container names. Never drive a run you did not launch.

## Doctor

```bash
$C doctor
```

Read-only. Fails (exit 1) when `bun`/`tmux` are missing, `dist/otter` is older than anything in `src/` (re-run `launch`), the sandbox HOME equals the real HOME, or the real `~/.otter/traces` file count changed since launch. Also prints the sandbox settings, whether a tmux session exists, and the state of the fixture containers. Run it first whenever anything looks off.

## Drive

Non-interactive (JSON because stdout is a pipe), with a saved transcript:

```bash
$C run <feature> <label> -- <otter args>      # e.g. $C run scan json -- scan --json --window 1
```

The transcript, `.stdout`, `.stderr`, and `.exit` land in `evidence/<id>/<feature>/<label>.*`. The helper returns otter's exit code. Always pass `--window 1`; the default 3 seconds only slows runs down (Docker collection alone takes about 5 seconds).

Interactive (human report, `clean` confirmation) uses a tmux session on a private socket:

```bash
$C tty start -- clean --window 1                          # real PTY; both stdin and stdout are TTYs
$C tty wait "OTTER_EXIT=" 60                              # wait for a literal string
$C tty screen                                             # capture the whole pane
$C tty drive-clean <feature> <label> <container-name|none>   # answers every prompt, see below
$C tty stop
```

`drive-clean` types the container name only for a prompt that contains both `target container <container-name>,` and `Type <container-name> to stop this container:`, and types `n` for every other prompt, which Otter treats as a decline. Pass `none` to decline everything. Real processes and protected executables (Tailscale, Clash on this Mac) can appear in `clean`; they must never be approved. The helper writes every prompt block and the answer to `<label>.decisions.txt` and the final pane to `<label>.screen.txt`. It waits for the `OTTER_EXIT=<code>` line that the wrapper prints after otter exits.

Docker fixture (needed only for `clean` execution):

```bash
$C fixture up      # two idle containers from $OTTER_VERIFY_IMAGE (default python:3.12-slim-bookworm, `sleep 3600`):
                   #   otter-verify-<id>          label otter.disposable=true  -> eligible candidate
                   #   otter-verify-<id>-control  no label                     -> must never be offered
$C fixture name    # prints the disposable container name for drive-clean
$C fixture state [feature label]   # running/exited/absent for both; optionally saved as evidence
$C fixture down
```

`fixture up` never pulls images. If the image is not local, set `OTTER_VERIFY_IMAGE` to one that is.

Second views (files, docker, grep) go through `$C note <feature> <label> -- <read-only command>`, which saves the command and output.

## Evidence

Location: `.agents/skills/verify-otter/evidence/<id>/<feature>/`. The directory has a self-ignoring `.gitignore`, so it stays out of commits, and `cleanup` never deletes it.

Proof standards:

- Use the real user path: the compiled `dist/otter`, its CLI flags, the real TTY prompt. Do not call internal functions, do not edit `settings.json` by hand (use `config set-*`), do not inject a fake command runner.
- Capture the action and the state it produced: the command and exit code, then a second view (trace event, docker state, file).
- Check side effects next to the visible output: trace files written, settings file contents, container state, nothing written to the real `~/.otter`.
- Compare against a control: the unlabeled container must still be `running` after a `clean` that approves the labeled one.
- Mocks: none. The only external boundary is the analyzer (`--send-llm`); its base URL is hardcoded in `src/config/settings.ts`, so the success path cannot be driven without a real key and is covered only by `tests/analyzer/`. Do not set a real key to "see what happens".
- Not driven here, on purpose: `config set-api-key` and `clear-api-key` (they write the real macOS Keychain; `HOME` does not isolate it), and the `kill_process` path (it needs a user-owned listening process older than eight hours with no terminal; covered by `tests/executor/actions.test.ts`). Report these as unverified rather than approximating them.

## Cleanup

```bash
$C cleanup
```

Kills only this run's tmux server (by its private socket), removes only this run's two containers by exact name, confirms the real `~/.otter/traces` count did not change, and deletes `/tmp/otter-verify-<id>`. It prints the evidence path and lists it. Run it after a failed attempt too. Never `pkill otter` or kill by process name. If you started a helper process of your own (for example the redaction marker process), kill it by the PID you captured.

## Helpers

Only `scripts/control-otter` ships. `$C help` lists its commands; every invocation is shown above and in the feature files.
