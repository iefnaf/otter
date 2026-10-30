# Stage 8: Intermediate Zoom Out Review

* **Target:** `design_draft.md` (full file, 613 lines)
* **Reviewer:** egm-zoom-out
* **Date:** 2026-10-30
* **Mode:** Interactive full flow

## Verdict

The document is substantially more coherent after the fixes: the pipeline, raw/redacted data boundary, local-only behavior, action narrowing, and evidence-level contract now fit together. The architecture still makes strategic sense as an on-demand, cross-system diagnostic tool. It is not implementation-ready yet: the Stage 5 privacy blocker remains, execution safety has one unresolved edge, and several Stage 6/7 contract fixes are only partially landed.

## Prior Issue Status

- **Stage 5 snapshot causal claims: mostly resolved, not completely.** The evidence-level contract (line 92), interval CPU correction (line 132), and Docker correlation fallback (line 140) are real improvements. Residual unsupported claims remain.
- **Stage 5 execution safety: substantially resolved, not fully.** Full local lineage is retained, stable entity references exist, and group killing was removed. A pre-execution safety gap remains.
- **Stage 5 privacy boundary: not resolved.** The Keychain and trace improvements are good, but unknown process arguments can still leave the machine and non-interactive modes bypass the stated consent flow.
- **Stage 7 process-group kill: resolved.** v1 now kills only one validated PID (line 282).
- **Stage 7 `quit_app`: resolved.** v1 has only `stop_container` and `kill_process` (line 228).
- **Stage 7 risk matrix: resolved structurally.** The matrix exists (line 49), with minor omissions.

## Findings

### BLOCKER — Pre-execution revalidation does not rerun the full safety predicate

**Scope:** Lines 251-252, 557, 559, 282.

Initial validation checks ownership, children, launchd labels, and container state. But the immediately-before-execution step only rechecks PID identity or container identity/state. A child can start, ownership can change, or a launchd label can appear while the user waits at the confirmation prompt. The SIGTERM-to-SIGKILL path does not say identity is rechecked before SIGKILL.

**Fix:** Revalidation should recompute the entire eligibility and blast-radius decision from fresh process, descendant, launchd, and container data. Abort on unknown state or before the fallback SIGKILL if identity changed.

### BLOCKER — Privacy-by-default is still not a true outbound data boundary

**Scope:** Lines 34, 53, 178, 188, 195, 197, 323, 326, 328.

Process arguments remain outbound, protected primarily by regex denylisting. The document acknowledges missed connection strings, internal names, and encoded tokens. A payload summary is not the exact payload. `scan --json`, `scan --yes`, and non-TTY mode can invoke the LLM with prompts disabled, contradicting the promise that normal scans ask before sending.

**Fix:** Classify command lines locally and transmit only executable name, normalized class, safe tags, lineage, and metrics. Non-interactive modes should default to no LLM transmission unless an explicit send flag is supplied.

### MAJOR — A few causal claims still exceed the collected evidence

**Scope:** Lines 21, 23, 32, 47, 126, 128, 204.

The document says "swap growth" while collecting only current swap usage, and claims "port activity" while collecting only listening sockets. The prompt asks for deterministic causal chains.

**Fix:** Rename to "current swap usage." Remove port-activity language or collect connection data. Require local predicates to check whether an `evidence_level` is permitted for each claim.

### MAJOR — Local risk classification has no output contract

**Scope:** Lines 226, 254, 256, 266, 275.

Removing `risk_level` from the LLM was correct, but the validator's `ValidatedRecommendation` is undefined. No mapping from "idle"/"stale" classifications to `safe`/`caution`/`dangerous` risk levels.

**Fix:** Define a `ValidatedRecommendation` interface with locally computed risk_level, blast_radius, eligibility_result, and measured_benefit.

### MAJOR — The 60-second goal remains unenforceable

**Scope:** Lines 35, 56, 144, 550.

A 30-second LLM timeout with one retry can consume 60 seconds alone, before collection and reporting.

**Fix:** Define one global run deadline (e.g., 45s). Derive stage deadlines from remaining budget. Retries only if they fit.

### MAJOR — Per-core CPU data is promised but not planned

**Scope:** Lines 127, 164, 524.

`LoadStats` requires per-core usage, but the system collector only plans `sysctl` load averages. `host_processor_info` is not a shell command.

**Fix:** Remove per-core data from v1 schema, or specify the native adapter.

### MAJOR — Rollout lacks diagnosis-quality gate for execution

**Scope:** Lines 405, 604, 610, 612.

Implementation proceeds directly from analyzer to executor, with no feature flag, pilot phase, or success threshold.

**Fix:** Add a feature flag for execution. Ship read-only diagnosis first, evaluate report quality against real snapshots, then enable execution.

### MAJOR — Container idleness does not establish stopping is intended

**Scope:** Lines 25, 270.

A quiet database, queue, or sidecar can still be required. Health-check status and restart policy collection not specified.

**Fix:** For v1, restrict executable stops to containers explicitly labeled as disposable dev resources. Otherwise render as advice-only.

### NIT — API-key exit codes contradict

**Scope:** Lines 330, 377.

Exit table says missing key is `4`; first-run behavior says exit `1`.

### NIT — File plan and CLI surface still drift

**Scope:** Lines 427, 439, 512-516.

Project tree omits `explain`, `clean`, `config` commands.

### NIT — `pgid` metadata is unnecessary v1 state

**Scope:** Lines 172, 60, 282.

v1 kills only single PID; `pgid` adds dead safety path.
