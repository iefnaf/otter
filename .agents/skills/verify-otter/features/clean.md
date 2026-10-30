# Guarded cleanup

`clean` shows each locally validated candidate and, only when every gate passes and the user types the exact confirmation text (the container name, `<executable> <pid>` for a listening process, or `y` for a process with no listening port), stops a disposable Docker container or terminates a stale process. It is the only command that can change the machine.

## Sub-features

- `clean-gate-disabled` refuses execution while `enableExecution` is false.
- `clean-gate-json` refuses execution for JSON or piped output.
- `clean-gate-localonly` refuses execution with `--local-only`.
- `clean-decline` leaves everything running when the user answers anything other than the exact text.
- `clean-approve` stops the approved disposable container and verifies it.
- `clean-dryrun` collects and validates without prompting or executing, and refuses `--send-llm`.
- `clean-control` never offers or touches a container without `otter.disposable=true`.
- `clean-audit` records `user_confirmed`, `action_executed`, and `action_verified` in the trace.

## How to get to it (user POV)

- Enable with `otter config set-execution enabled`, then run `otter clean` in a terminal.
- Run `otter clean --json` or `otter clean --local-only` (never executes).

## Driving it with control-otter

Preconditions: fresh launch, `$C doctor` exits 0, Docker running, `$C fixture up` done, `$C fixture state` prints `disposable=running control=running`.

- **Disabled.** `$C run clean disabled -- clean --json --window 1`. `execution` is `{"enabled": false, "status": "disabled", "reason": "Execution is disabled in settings."}`.
- **Enable.** `$C run clean enable -- config set-execution enabled`.
- **JSON refused.** `$C run clean json -- clean --json --window 1`. `execution.status` is `not_available` with `JSON output cannot provide the required per-candidate confirmation.`.
- **Local-only refused.** `$C run clean localonly -- clean --local-only --json --window 1`. `execution.status` is `not_available` with `Local-only mode is diagnostic and never executes.`.
- **Decline.** `$C tty start -- clean --window 1`, then `$C tty drive-clean clean-decline run none`, then `$C fixture state clean-decline after`. The decisions file shows one prompt that names `target container otter-verify-<id>,` and ends `Type otter-verify-<id> to stop this container:`, answered `n`. The screen ends `execution complete: Per-candidate interactive confirmation is active.` and `OTTER_EXIT=0`. `fixture state` prints `disposable=running control=running`. Then `$C tty stop`.
- **Approve.** `$C tty start -- clean --window 1`, then `$C tty drive-clean clean-approve run "$($C fixture name)"`, then `$C fixture state clean-approve after`. The decisions file shows the prompt answered with the typed container name. The screen ends with `action results 1 succeeded`. `fixture state` prints `disposable=exited control=running`. Then `$C tty stop`.
- **Audit.** `$C run trace list -- trace list`, then `$C run clean-audit show -- trace show <top run id>`. The events include `user_confirmed` with `approved: true`, `action_executed` with `status: succeeded`, `action_verified` with `status: verified`.
- **Dry run (JSON).** With execution enabled, `$C run clean-dryrun json -- clean --dry-run --json --window 1`. `execution.status` is `not_available` with reason `Dry-run mode collects and validates but never executes.`, and `execution.enabled` is `false`.
- **Dry run (TTY).** `$C tty start -- clean --dry-run --window 1`, `$C tty wait "OTTER_EXIT=" 90`, `$C tty screen`. The screen has no `Type ... to stop` line, ends with `execution not_available: Dry-run mode collects and validates but never executes.`, `action results none`, and `OTTER_EXIT=0`. `$C fixture state clean-dryrun after` prints `disposable=running control=running`. `trace show <run id>` has exactly `collection_started, collection_completed, redaction_applied, recommendations_validated, run_completed`: no `user_confirmed`, no `action_executed`.
- **Dry run with analyzer.** `$C run clean-dryrun llm -- clean --dry-run --send-llm`. Exit `2`, stderr `--dry-run does not send an analyzer request`.
- **Reset.** `$C run clean disable -- config set-execution disabled`.

## Gotchas

- Real processes on this Mac may also be eligible (user-owned, listening, no terminal, over eight hours, under 1 percent CPU, not in `launchctl`). Their prompts appear in `drive-clean` and are answered `n`. Never approve a prompt that does not name the fixture container.
- Only `clean` after `fixture up` has a container prompt. Without the fixture the screen may show no prompt and `drive-clean` reports `answered 0`.
- A prompt for a process with no listening port expects `y`; one for a listening process expects `<executable> <pid>`. `drive-clean` types `n` for all of them.
- A binary built before `dryRun` was forwarded from `src/index.ts` prompts under `--dry-run`. `doctor` flags a stale binary; if the dry-run TTY screen shows a `Type ... to stop` line, stop it with `$C tty stop`, rebuild with `launch`, and report the failure.
- Approving stops the container; running `clean` again finds nothing eligible. Re-run `fixture down` then `fixture up` to repeat.
- The `kill_process` path is not drivable here: it needs a real stale listener older than eight hours. Report it as unverified; `tests/executor/actions.test.ts` covers it.
- `clean` takes about 10 seconds: Docker collection, then revalidation before the action.
- The prompt takes its answer from stdin. Piping an answer or running without a PTY is refused by design, so there is no way to bypass the TTY check.
