# Guarded cleanup

`clean` shows each locally validated candidate and, only when every gate passes and the user types the exact confirmation text (the container name, `<executable> <pid>` for a listening process, or `y` for a process with no listening port), stops a disposable Docker container or terminates a stale process. It is the only command that can change the machine.

## Sub-features

- `clean-gate-disabled` refuses execution while `enableExecution` is false.
- `clean-gate-json` refuses execution for JSON or piped output.
- `clean-gate-localonly` refuses execution with `--local-only`.
- `clean-decline` leaves everything running when the user answers anything other than the exact text.
- `clean-approve` stops the approved disposable container and verifies it.
- `clean-dryrun` is meant to collect and validate without prompting or executing (currently broken, see Gotchas).
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
- **Dry run (expected to fail today).** `$C run clean-dryrun json -- clean --dry-run --json --window 1`: expect `execution.reason` `Dry-run mode collects and validates but never executes.` The current binary instead reports `JSON output cannot provide the required per-candidate confirmation.`, because `dryRun` is parsed in `src/index.ts` but not passed to `runDiagnostic`. On a TTY, `$C tty start -- clean --dry-run --window 1` still shows `Type otter-verify-<id> to stop this container:`. Stop it with `$C tty stop` and report the journey as failed; do not weaken it.
- **Dry run with analyzer (also fails today).** `$C run clean-dryrun llm -- clean --dry-run --send-llm` should exit `2` with `--dry-run does not send an analyzer request`; it exits `4` with `NO_API_KEY`.
- **Reset.** `$C run clean disable -- config set-execution disabled`.

## Gotchas

- Real processes on this Mac may also be eligible (user-owned, listening, no terminal, over eight hours, under 1 percent CPU, not in `launchctl`). Their prompts appear in `drive-clean` and are answered `n`. Never approve a prompt that does not name the fixture container.
- Only `clean` after `fixture up` has a container prompt. Without the fixture the screen may show no prompt and `drive-clean` reports `answered 0`.
- A prompt for a process with no listening port expects `y`; one for a listening process expects `<executable> <pid>`. `drive-clean` types `n` for all of them.
- Never run `clean --dry-run` on a TTY with execution enabled and an answerable prompt: until `dryRun` is forwarded it behaves like a normal `clean`.
- Approving stops the container; running `clean` again finds nothing eligible. Re-run `fixture down` then `fixture up` to repeat.
- The `kill_process` path is not drivable here: it needs a real stale listener older than eight hours. Report it as unverified; `tests/executor/actions.test.ts` covers it.
- `clean` takes about 10 seconds: Docker collection, then revalidation before the action.
- The prompt takes its answer from stdin. Piping an answer or running without a PTY is refused by design, so there is no way to bypass the TTY check.
