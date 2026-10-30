# Traces

Every `scan`, `explain`, and `clean` run writes a redacted JSONL trace under `~/.otter/traces`. `trace list|show|export` read them back. Traces hold the redacted projection only, never raw snapshots or process arguments.

## Sub-features

- `trace-list` lists runs, newest first, as `<run-id> <bytes>`.
- `trace-show` prints one JSON event per line in sequence order.
- `trace-export` prints the same events as exportable JSONL.
- `trace-validation` rejects malformed run IDs and unknown roots.
- `trace-private` creates the directory as `0700` and files as `0600`, with an ownership marker.

## How to get to it (user POV)

- Run `otter trace list`.
- Run `otter trace show <run-id>`.
- Run `otter trace export <run-id>`.

## Driving it with control-otter

Preconditions: at least one `scan` has run in this sandbox (`$C run trace seed -- scan --json --window 1`).

- **List.** `$C run trace list -- trace list`. Exit `0`, one line per run, `<YYYYMMDDTHHMMSS-xxxxxx> <size>`. The run ID printed in the scan's JSON (`runId`) is the top line.
- **Show.** `RID=$(head -1 .agents/skills/verify-otter/evidence/$OTTER_VERIFY_RUN/trace/list.stdout | cut -d' ' -f1)` then `$C run trace show -- trace show $RID`. The `eventType` sequence for a scan is `collection_started, collection_completed, redaction_applied, recommendations_validated, run_completed` with `seq` 0 to 4.
- **Export.** `$C run trace export -- trace export $RID`. Exit `0`, the same five events.
- **Reject bad ID.** `$C run trace bad-id -- trace show ../etc/passwd`. Exit `2`, stderr `invalid trace run ID`.
- **Unknown run.** `$C run trace missing -- trace show 20200101T000000-abcdef`. Exit `2` (see Gotchas for the message).
- **Private modes.** `$C note trace modes -- bash -c 'ls -ld /tmp/otter-verify-'$OTTER_VERIFY_RUN'/home/.otter/traces; ls -l /tmp/otter-verify-'$OTTER_VERIFY_RUN'/home/.otter/traces'` shows `drwx------` for the directory, `-rw-------` for the files, and `.otter-traces`.
- **Real store untouched.** `$C doctor` still reports the real `~/.otter/traces` count unchanged.

## Gotchas

- In a fresh sandbox, `trace list` before any scan exits `2` with an `ENOENT ... scandir` message, because the directory does not exist yet. Run a scan first.
- `trace show <valid-looking id>` for a run that does not exist in a fresh store prints `directory is not an Otter trace root`, which is accurate only after a scan has created the marker.
- Otter keeps 100 traces and deletes the oldest. Do not assert on the total count across long runs.
- Run IDs use UTC wall time, so they look hours off the local clock.
