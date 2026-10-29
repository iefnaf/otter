# Stage 9: Implementation Readiness Test

* **Target:** `design_draft.md` DetailedRange (lines 425-613)
* **Reviewers:** egm-implementation-readiness, egm-codebase-details
* **Date:** 2026-10-30
* **Mode:** Interactive full flow

## Verdict

**NOT READY FOR IMPLEMENTATION.** Both reviewers independently concluded the plan is not executable as written. The technical architecture provides useful context, but the implementation plan still requires significant design decisions, contains conflicting contracts, and does not provide a safely ordered, verifiable execution sequence.

## Consolidated Findings

### Theme 1: Implementation Order & File Plan (3 BLOCKERs)

**B1 — Implementation order dependencies are broken.** Step 6 enables `otter scan` with LLM reports before reporter exists (step 8). Executor requires trace events before trace store exists (step 10). Validator should gate scan's recommendations but comes after.

**B2 — File list internally inconsistent.** Project tree omits `explain.ts`, `clean.ts`, `config.ts`. `src/index.ts` told to register only `scan` and `trace`. No owner for settings persistence, `RedactedSnapshot` type, local-only rendering, or executor result types.

**B3 — CLI contract incomplete and contradictory.** `index.ts` parses only 4 options; Technical Plan requires `--yes`/`--no-exec`. Exit codes conflict (missing key: `1` vs `4`). `--local-only --json` behavior undefined.

### Theme 2: Data Collection Impossible As Specified (4 BLOCKERs)

**B4 — Per-collector timeout vs interval window.** Default 3s timeout cannot support 5-10s sampling window plus command overhead. Docker `stats` takes 2s+ per call. Need `timeout = window + overhead` formula.

**B5 — Per-core CPU assigned to non-existent command.** `host_processor_info` is a Mach API, not a shell command. Requires native addon or removal from v1.

**B6 — `ps` command missing required fields.** Output is fixed-width not tab-separated. Missing `state` and `tt` fields needed for stale-process rule (`TT == ??`) and zombie detection. `lstart` is variable-width. No parsing grammar defined.

**B7 — Docker idle validation data insufficient.** `docker ps --format json` doesn't expose restart policy or reliable health state. `docker stats --format json` gives formatted percentages, not raw CPU counters. Need `docker inspect` + Docker API stats stream, or redefine idle calculation.

### Theme 3: Safety Execution Gaps (2 BLOCKERs)

**B8 — Revalidation incomplete (Stage 8 repeat).** Only checks PID identity before execution. Doesn't recheck ownership, children, launchd state. SIGKILL fallback doesn't reverify PID wasn't reused.

**B9 — Risk classification unimplementable.** No mapping from safety checks to `safe`/`caution`/`dangerous`. No `ValidatedRecommendation` contract. Typed-name confirmation for dangerous actions absent from implementation plan. `resolver.ts` accepts string but `target_ref` is typed union.

### Theme 4: Privacy Contradictions (1 BLOCKER)

**B10 — Consent flow bypassed in non-interactive modes (Stage 8 repeat).** `--json`, `--yes`, and non-TTY modes invoke LLM without payload consent prompt, contradicting "always asks" promise. Must either: non-interactive defaults to no LLM, or require explicit `--send-llm` flag.

### Theme 5: LLM & Prompt Gaps (1 BLOCKER)

**B11 — Prompt and analyzer behavior unspecified.** No prompt template, no few-shot examples, no model parameters, no JSON schema enforcement method, no `explain` variant, no fallback report format. Diagnosis quality is the core value; leaving prompt design to implementer fails zero-decision rule.

## Major Findings (deduplicated, 12 items)

**M1 — Redaction algorithms undefined.** No hash algorithm, salt behavior, deterministic vs per-run, regex patterns, path segmentation, IPv6 handling, or container-name allowlist. Truncation-vs-redaction ordering unspecified. Path example has 3 directories → 2 hashes.

**M2 — Payload tiering not computable.** "CPU × memory composite score" undefined. Multicore CPU can exceed 100%. "Full metadata" undefined. Summary aggregation semantics unclear. No token/byte ceiling.

**M3 — Docker daemon detection under-specified.** `docker info --format json` can output valid JSON with exit 1 when daemon down. Container-to-host-process mapping doesn't exist as described (containers share the VM process).

**M4 — System/memory collection semantics undecided.** Which `sysctl` keys, logical vs physical cores, `vm_stat` free vs speculative pages, `memory_pressure` reconciliation, swap parser.

**M5 — `lsof` permission behavior contradictory.** Architecture says `denied`; implementation says `partial`. Full Disk Access doesn't solve other-user socket inspection. Exit code/stderr classification undefined.

**M6 — `launchctl list` insufficient.** Lists current user's GUI domain only. Doesn't cover system domain. PID-to-label correlation undefined. Managed/restarting services can pass the check.

**M7 — Keychain setup incomplete.** Missing `-U` flag for update. Secret passed via argv (visible to other processes). No error handling for absent/cancelled/error states.

**M8 — Trace contracts conflict.** Event types: snake_case (architecture) vs PascalCase (implementation). Payload `unknown` with no Zod schema. Store omits `0700` permissions, run-ID collision handling, append failure behavior, export sanitization.

**M9 — Test fixtures insufficient.** Single `ps` fixture can't test two-sample deltas. No fixtures for `sysctl`, swap, boottime, launchd, Docker inspect, paired Docker stats. Safety tests approve idle container without data proving idleness.

**M10 — Test plan omits critical infrastructure.** No tests for snapshot builder, collector orchestration, CLI modes, config/Keychain, resolver/revalidation, executor TOCTOU, verification, trace, reporters, SIGINT.

**M11 — Bun/TypeScript scaffold incomplete.** No package versions, lockfile policy, build commands, Bun type package, bundler module resolution, or binary entrypoint.

**M12 — Entity references contradictory.** `evidence_refs` has no grammar. `target_ref` is typed union in architecture but string in `resolver.ts`. Validation receives raw or redacted snapshot? Undefined.

## Nits

**N1 — Trace filename collision risk.** Same-second timestamp collisions possible. Run-ID to filename relationship undefined.

**N2 — Gatekeeper not addressed.** Unsigned Bun binary requires trust steps. Acceptable for local dev; should be explicitly out of MVP scope.
