# Payload preview and analyzer gate

`--preview-payload` prints the exact redacted payload that could be sent to an analyzer, then exits. `--send-llm` is the only path that may contact an analyzer, and it needs an API key. Without it Otter stays local.

## Sub-features

- `payload-preview` prints the redacted payload and exits `0` without validating or executing candidates.
- `payload-redaction` keeps process arguments and container names out of the payload and traces.
- `payload-gate-nokey` refuses `--send-llm` without a key (exit `4`, `NO_API_KEY`).
- `payload-flag-conflicts` rejects `--local-only --send-llm` and `--preview-payload --send-llm`.

## How to get to it (user POV)

- Run `otter scan --preview-payload`.
- Run `otter scan --send-llm` or `otter explain --send-llm`.
- Read a trace with `otter trace show <run-id>`.

## Driving it with control-otter

Preconditions: `$C doctor` exits 0. The harness unsets `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` and the sandbox HOME has no Keychain item, so no key is available. `config show` reports `"keychainConfigured": false`.

- **Preview.** Run `$C run payload preview -- scan --preview-payload --window 1`. Exit `0`. Stdout keys are `schemaVersion, runId, machine, memory, load, collectorStatus, ports, docker, processTiers, candidateBook`. There is no `validatedCandidates` or `execution` key.
- **Redaction of arguments (with a positive control).** Start a process whose command line carries a marker: `bash -c 'sleep 600; :' OTTER_SECRET_MARKER_$OTTER_VERIFY_RUN &` and keep its PID with `MP=$!`. Prove the marker is visible to `ps`: `$C note payload marker-visible -- bash -c "ps -ax -o pid,command | grep '[O]TTER_SECRET_MARKER'"` must print a line. Run `$C run payload scan -- scan --json --window 1`, then `kill $MP`. Count the marker in stdout and in the trace: `$C note payload marker-in-trace -- bash -c "grep -c OTTER_SECRET_MARKER /tmp/otter-verify-$OTTER_VERIFY_RUN/home/.otter/traces/*.jsonl | grep -v ':0$' || echo none"` prints `none`. A zero count without the visible positive control proves nothing.
- **Container names are hashed.** With `fixture up`, `$C run payload preview2 -- scan --preview-payload --window 1` and `$C note payload name-leak -- bash -c "grep -c \"$($C fixture name)\" .agents/skills/verify-otter/evidence/$OTTER_VERIFY_RUN/payload/preview2.stdout || true"` prints `0`.
- **No key.** Run `$C run payload nokey -- scan --send-llm --window 1`. Exit `4`, stdout empty, stderr `NO_API_KEY`. Its trace (`trace show <id>`) ends with `run_failed` and has no `llm_request_sent` event.
- **Flag conflicts.** `$C run payload conflict1 -- scan --local-only --send-llm` exits `2` with `--local-only and --send-llm cannot be combined`. `$C run payload conflict2 -- scan --preview-payload --send-llm` exits `2` with `--preview-payload stops before LLM transmission`.
- **Proof.** The saved `payload/*.txt` files and the marker counts.

## Gotchas

- `bash -c 'sleep 600'` is exec-optimized to plain `sleep 600`, so the marker never reaches the command line. Use a compound command such as `sleep 600; :` and confirm the marker with `ps` first.
- The success path of `--send-llm` (request, response validation, advisory output) cannot be driven: the analyzer base URL is fixed to the OpenAI or DeepSeek host. It is unverified by this map; unit tests cover it. Do not export a real key to try it.
- The no-key trace stops before `llm_request_sent`. The absence of that event is the only in-repo evidence of "no request"; it is not a network capture.
- Candidate IDs in the payload differ on every run.
