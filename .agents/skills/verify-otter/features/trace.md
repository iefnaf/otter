# Traces and history

Every `scan`, `explain`, and `clean` run writes a redacted JSONL trace under `~/.otter/traces`. `trace list|show|export` read them back, and `history` summarizes prior runs. Traces hold the redacted projection only, never raw snapshots or process arguments.

## Sub-features

- `trace-list` lists runs, newest first, as `<run-id> <bytes>`.
- `trace-show` prints one JSON event per line in sequence order.
- `trace-export` prints the same events as exportable JSONL.
- `history` prints one line per run: approvals, stops, failures, verification counts, executable and blocked counts.
- `trace-validation` rejects malformed run IDs and unknown roots.
- `trace-private` creates the directory as `0700` and files as `0600`, with an ownership marker.

## How to get to it (user POV)

- Run `otter trace list`.
- Run `otter trace show <run-id>`.
- Run `otter trace export <run-id>`.
- Run `otter history`.

## Driving it with control-otter

Preconditions: at least one `scan` has run in this sandbox (`$C run trace seed -- scan --json --window 1`).

- **List.** `$C run trace list -- trace list`. Exit `0`, one line per run, `<YYYYMMDDTHHMMSS-xxxxxx> <size>`. The run ID printed in the scan's JSON (`runId`) is the top line.
- **Show.** `RID=$(head -1 .agents/skills/verify-otter/evidence/$OTTER_VERIFY_RUN/trace/list.stdout | cut -d' ' -f1)` then `$C run trace show -- trace show $RID`. The `eventType` sequence for a scan is `collection_started, collection_completed, redaction_applied, recommendations_validated, run_completed` with `seq` 0 to 4.
- **Export.** `$C run trace export -- trace export $RID`. Exit `0`, the same five events.
- **Reject bad ID.** `$C run trace bad-id -- trace show ../etc/passwd`. Exit `2`, stderr `invalid trace run ID`.
- **Unknown run.** `$C run trace missing -- trace show 20200101T000000-abcdef`. Exit `2`, stderr is an `ENOENT ... open` error for that file.
- **History.** `$C run trace history -- history`. Exit `0`; first line `run                   command   result`, then one line per run, newest first. After a `clean` that approved the fixture, its line reads `1 approved, 1 stopped, 0 failed; 1 verified, 0 active, 0 unknown`.
- **Private modes.** `$C note trace modes -- bash -c 'ls -ld /tmp/otter-verify-'$OTTER_VERIFY_RUN'/home/.otter/traces; ls -l /tmp/otter-verify-'$OTTER_VERIFY_RUN'/home/.otter/traces'` shows `drwx------` for the directory, `-rw-------` for the files, and `.otter-traces`.
- **Real store untouched.** `$C doctor` still reports the real `~/.otter/traces` count unchanged.

## Gotchas

- In a fresh sandbox, `trace list` and `history` before any scan succeed with no output lines (history prints only its header). Older builds failed with `ENOENT scandir`; if you see that, the binary is stale.
- `trace show <valid-looking id>` for a run that does not exist in a fresh store prints `directory is not an Otter trace root`, which is accurate only after a scan has created the marker.
- Otter keeps 100 traces and deletes the oldest. Do not assert on the total count across long runs.
- Run IDs use UTC wall time, so they look hours off the local clock.
