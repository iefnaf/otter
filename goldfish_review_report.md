# Goldfish Annotated Review Report

**Target:** `design_draft.md` (FeatureRange, lines 1-365)
**Source:** Stage 7 Critic Review (`critic_report.md`)

## Prioritized Findings & AI Suggestions

### BLOCKER 1 — Process-group execution can kill unrelated processes

* **Discrepancy:** `process.kill(-pid)` assumes PID equals PGID. Process groups can contain orphans and unrelated processes. Safety check only rejects direct children.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid and dangerous. Killing a single validated PID is safer than signaling a group. Group semantics add complexity without clear v1 value.
* **Proposed Edit:** Replace `kill_process_group` with `kill_process` (single PID, SIGTERM then SIGKILL). Update schema, action types, executor table, and safety checks accordingly.

### BLOCKER 2 + MAJOR 16 — Remove `quit_app` from v1

* **Discrepancy:** `quit_app` has no app entity in snapshot, no immutable identity, no safety classification, and cannot be safely revalidated.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. `quit_app` is the weakest action type and adds the most risk. The stated v1 boundary (idle containers + stale dev servers) does not require it.
* **Proposed Edit:** Remove `quit_app` from `action_type` enum, `EntityRef`, executor table, and any prose mentioning it. Reduce to two action types: `stop_container` and `kill_process`.

### BLOCKER 3 — Add Risks & Mitigations section

* **Discrepancy:** No consolidated risk catalog for LLM outage, permission degradation, prompt injection, version compatibility, payload limits, or partial collection.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The feature-spec standard requires this and the document needs it for implementation readiness.
* **Proposed Edit:** Add a `## Risks & Mitigations` section after `## Non-Goals` with a risk matrix covering: privacy leakage, wrong-target execution, LLM failure, partial collection, Docker version drift, payload size limits, and degraded-mode behavior.

### MAJOR 1 — Derive risk_level locally, not from LLM

* **Discrepancy:** `risk_level` is model-generated and controls confirmation friction. A prompt-injected model can mislabel a dangerous action as safe.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. Safety policy must be deterministic. The LLM can suggest an action but local code must classify its risk from system facts.
* **Proposed Edit:** Move `risk_level` out of the LLM response schema. Local validator computes risk from target properties: root-owned → dangerous, has children → caution, stale + idle → safe. LLM provides `reason` text only.

### MAJOR 2 — Make payload preview atomic

* **Discrepancy:** `--preview-payload` collects one snapshot; a subsequent scan collects another. Preview does not show the exact payload.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The privacy promise requires showing the exact outbound data.
* **Proposed Edit:** Redefine: `otter scan` always shows the redacted payload summary and asks for consent before sending. `--preview-payload` shows the payload and exits without the LLM step (same snapshot, just stops earlier). `--yes` flag skips the confirmation for trusted users.

### MAJOR 3 — Fix redaction example and export safety

* **Discrepancy:** Path rule says hash everything but example preserves directories. Trace export labeled "shareable" despite acknowledged redaction gaps.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The example contradicts the rule. Export with residual sensitive data is a privacy hole.
* **Proposed Edit:** Fix path example to `[HASH]/[HASH]/index.ts`. Rename trace export to `otter trace export --sanitized` with an explicit warning that it applies strict sanitization. Default export omits process arguments entirely.

### MAJOR 4 — Define CLI interaction modes and exit codes

* **Discrepancy:** `--json` conflicts with interactive prompts. Non-TTY behavior undefined. No `--yes`/`--no-exec` flags. Exit codes incomplete.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. A CLI tool must define its terminal states for scripting.
* **Proposed Edit:** Add a mode table: interactive (default with TTY), `--json` (never prompts, reports only), `--yes` (skip confirmations, still executes), `--no-exec` (never executes). Document exit codes: 0 = success, 1 = partial failure, 2 = fatal error, 3 = user cancelled, 4 = no API key.

### MAJOR 5 — Hedge causal language and label post-action limits

* **Discrepancy:** Overview example says "This is the main reason" but confidence contract says this is a hypothesis. 3-second post-action sample is too short to verify swap reclamation.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The document sets an evidence standard then violates it in its own example.
* **Proposed Edit:** Rewrite example with hedged language: "The evidence suggests Docker's memory reservation is a likely contributor to swap growth." Label post-action verification as "short-term observation" and state it may not reflect swap or Docker VM memory reclamation.

### MAJOR 6 — Add stale-candidate tier to payload

* **Discrepancy:** Stale dev servers are low-resource and fall into summary tier, losing entity IDs and lineage needed for recommendations.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. This breaks a core product goal — identifying stale dev servers.
* **Proposed Edit:** Add a third tier: "candidate tier" — user-owned processes with listening ports, runtime > 4 hours, or no controlling terminal. Always sent with full metadata regardless of resource ranking.

### MAJOR 7 — Define "managed by launchd" operationally

* **Discrepancy:** "Managed by launchd" is undefined. Orphaned processes have PPID 1 but are not launchd services.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The current rule would protect the exact processes the tool targets.
* **Proposed Edit:** Replace with: "Protected = process appears in `launchctl list` output as a labeled service (not just PPID 1)." The collector optionally runs `launchctl list` to build a set of managed service PIDs. If launchctl is unavailable, protected check returns `unknown` and the action is blocked.

### MAJOR 8 — Collect two Docker stats samples

* **Discrepancy:** `docker stats --no-stream` is a single sample, but threshold says "over sampling window."
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The threshold as written is unimplementable.
* **Proposed Edit:** Run `docker stats --no-stream` twice with the sampling window between samples. Calculate container CPU delta the same way as process CPU. Store both samples in `DockerState`.

### MAJOR 9 — Update architecture diagram

* **Discrepancy:** Diagram shows LLM → Reporter/Executor directly. Validator and confirmation step are missing.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. The diagram should match the described pipeline.
* **Proposed Edit:** Redraw the ASCII diagram: Collector → Normalizer → Redactor → LLM Analyzer → Validator → User Confirmation → Executor → Verifier → Reporter. Add trace store connected to all stages.

### MAJOR 10 — Define RedactedSnapshot boundary

* **Discrepancy:** No named `RedactedSnapshot` schema. Unclear which components consume raw vs. redacted data.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. Data boundary must be explicit for both privacy and implementation.
* **Proposed Edit:** Add: `SystemSnapshot` (raw, in-memory only, used by validator and executor) and `RedactedSnapshot` (derived, sent to LLM, stored in trace). State explicitly: validator and executor never see the RedactedSnapshot; analyzer never sees the SystemSnapshot.

### MAJOR 11 — Define nested types and unify collector status

* **Discrepancy:** `MachineInfo`, `MemoryStats`, `ProcessInfo`, `PortBinding`, `DockerState` referenced but not defined. Collector status listed inconsistently.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. A fresh implementer needs the complete schema.
* **Proposed Edit:** Add TypeScript interface definitions for all nested types under the snapshot schema. List collector status enum once: `complete | partial | failed | skipped | denied`.

### MAJOR 12 — Define mode-specific analyzer schemas

* **Discrepancy:** `DiagnosticReport` requires recommendations, but `explain` skips them. `--local-only` uses raw metrics. Top-level `confidence` undefined.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. One schema can't serve three modes.
* **Proposed Edit:** Remove top-level `confidence` (redundant with per-finding `evidence_level`). Make `recommendations` optional in the schema. `explain` mode uses a prompt variant that requests findings only. `--local-only` bypasses the analyzer entirely.

### MAJOR 13 — Add ExecutionResult schema and failure handling

* **Discrepancy:** No behavior defined for execution failures, partial failures, or timeouts.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. Execution needs error contracts.
* **Proposed Edit:** Add `ExecutionResult` interface: `{ action_id, status: succeeded | failed | partially_succeeded | target_changed, error_code, message }`. On failure of one action, continue with remaining confirmed actions, report each result individually.

### MAJOR 14 — Define trace event schema

* **Discrepancy:** No event envelope, run ID, or sequence number. User confirmation inputs may leak sensitive data.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. Trace needs a defined format.
* **Proposed Edit:** Add `TraceEvent` interface: `{ run_id, seq, timestamp, event_type, payload }`. Sanitize user inputs (target names) through the same redaction rules before persisting. Trace-write failure: log warning to stderr, continue execution.

### MAJOR 15 — Replace "safe" terminology

* **Discrepancy:** "Safe" used both as product property and specific risk level. Document promises "without breaking anything" while allowing dangerous execution.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. Terminology conflict confuses readers.
* **Proposed Edit:** Use "guarded execution" or "allowlisted actions" for the product property. Remove "without breaking anything" and all absolute safety claims. Keep `safe` only as the risk-level enum value.

### MAJOR 17 — Add Docker VM detection fallback

* **Discrepancy:** Assumes stable process signature and `docker system info` fields. No version matrix.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Valid. External dependency needs degradation behavior.
* **Proposed Edit:** Add: "Docker VM detection tries multiple strategies: (1) process name match, (2) `docker system info` VM fields, (3) inference from `com.docker.virtualization` process. If none succeed, Docker VM correlation is marked `unknown` and the LLM is told not to infer the relationship."

### NIT 1 — Fix "macOS APIs" diagram label

* **AI Suggestion:** PROPOSE FIX
* **Proposed Edit:** Change to "macOS system commands."

### NIT 2 — Remove "or provider SDK" from dependency table

* **AI Suggestion:** PROPOSE FIX
* **Proposed Edit:** Change to just `openai`.

### NIT 3 — Clarify `clean` non-interactive behavior

* **AI Suggestion:** PROPOSE FIX
* **Proposed Edit:** Remove scripting justification for `clean`. State it is a user-facing alias only.
