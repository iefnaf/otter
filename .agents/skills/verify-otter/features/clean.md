# Guarded cleanup

`clean` shows each locally validated candidate and, only when every gate passes and the user types `y` to that exact candidate, stops a disposable Docker container or terminates a stale process. It is the only command that can change the machine.

## Sub-features

- `clean-gate-disabled` refuses execution while `enableExecution` is false.
- `clean-gate-json` refuses execution for JSON or piped output.
- `clean-gate-localonly` refuses execution with `--local-only`.
- `clean-decline` leaves everything running when the user answers `n`.
- `clean-approve` stops the approved disposable container and verifies it.
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
- **Decline.** `$C tty start -- clean --window 1`, then `$C tty drive-clean clean-decline run none`, then `$C fixture state clean-decline after`. The decisions file shows one prompt that names `target container otter-verify-<id>,` answered `n`. The screen ends `execution complete: Per-candidate interactive confirmation is active.` and `OTTER_EXIT=0`. `fixture state` prints `disposable=running control=running`. Then `$C tty stop`.
- **Approve.** `$C tty start -- clean --window 1`, then `$C tty drive-clean clean-approve run "$($C fixture name)"`, then `$C fixture state clean-approve after`. The decisions file shows the prompt answered `y`. The screen has `stop_container, eligible, safe`, then `succeeded, Container is stopped.` and `verified, Short-term observation: container is stopped.`. `fixture state` prints `disposable=exited control=running`. Then `$C tty stop`.
- **Audit.** `$C run trace list -- trace list`, then `$C run clean-audit show -- trace show <top run id>`. The events include `user_confirmed` with `approved: true`, `action_executed` with `status: succeeded`, `action_verified` with `status: verified`.
- **Reset.** `$C run clean disable -- config set-execution disabled`.

## Gotchas

- Real processes on this Mac may also be eligible (user-owned, listening, no terminal, over eight hours, under 1 percent CPU, not in `launchctl`). Their prompts appear in `drive-clean` and are answered `n`. Never approve a prompt that does not name the fixture container.
- Only `clean` after `fixture up` has a container prompt. Without the fixture the screen may show no prompt and `drive-clean` reports `answered 0`.
- Approving stops the container; running `clean` again finds nothing eligible. Re-run `fixture down` then `fixture up` to repeat.
- The `kill_process` path is not drivable here: it needs a real stale listener older than eight hours. Report it as unverified; `tests/executor/actions.test.ts` covers it.
- `clean` takes about 10 seconds: Docker collection, then revalidation before the action.
- The prompt takes its answer from stdin. Piping `y` or running without a PTY is refused by design, so there is no way to bypass the TTY check.
