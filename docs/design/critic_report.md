# Stage 7: Critic Review

* **Target:** `design_draft.md` FeatureRange (lines 1-365)
* **Reviewers:** egm-design, egm-structural, egm-style
* **Date:** 2026-10-30
* **Mode:** Interactive full flow

## Consolidated Findings

### BLOCKER 1 — Process-group execution can kill unrelated or active processes

**Source:** Design Critic + Structural

`process.kill(-pid, ...)` assumes the target PID is also the process-group leader. The schema stores `pgid` separately, but the executor ignores it. Even when `pid === pgid`, a process group can contain grandchildren, reparented workers, or unrelated processes sharing the group. The safety check only rejects targets with direct active children, so it does not protect every process that `kill(-pid)` will signal.

**Required fix:** Use the stored `pgid`, enumerate every current group member immediately before execution, reject mixed or changing groups, and require every member to pass safety checks. Alternatively, kill only the validated PID rather than the group.

### BLOCKER 2 — `quit_app` cannot be safely revalidated and has no source entity

**Source:** Design Critic + Structural

The `EntityRef` for apps contains only `app_name` and `pid` — no immutable identity (start time, bundle ID). `quit app "<name>"` resolves by name at execution time. If the original PID exits and another instance launches, Otter can quit the wrong instance. `SystemSnapshot` has no app entity collection. `quit_app` also lacks a deterministic safety classification and is broader than the stated cleanup boundary.

**Required fix:** Remove `quit_app` from v1, or define app identity, resolution, revalidation, and eligibility rules equivalent to the container/process rules.

### BLOCKER 3 — Missing Risks & Mitigations section

**Source:** Structural

The document has no consolidated risk catalog. Execution failures, partial telemetry, API outages, permission degradation, trace disclosure, shell-command safety, model misclassification, prompt injection, Docker version compatibility, and payload scalability are not systematically catalogued with mitigations.

**Required fix:** Add a `Risks & Mitigations` section covering privacy, execution safety, LLM reliability and cost, collection failures, compatibility, adversarial input, and degraded-mode behavior.

### MAJOR 1 — LLM controls safety-critical UX claims

**Source:** Design Critic + Structural

`risk_level`, `reason`, `expected_benefit`, and `blast_radius` are model-generated. Local validation checks schema and target existence but not whether risk labels or impact claims are true. A prompt-injected model can label a destructive action as `safe`. All risk levels remain executable.

**Required fix:** Derive risk level and blast radius deterministically from local system facts. Treat model-written rationale as unverified explanatory text. Local code owns safety policy, not the LLM.

### MAJOR 2 — Payload preview does not show the exact payload

**Source:** Design Critic

`--preview-payload` collects one snapshot and exits. A subsequent scan collects a new snapshot, so the preview differs from what is sent. Normal scans do not display or require consent to the outbound payload.

**Required fix:** Make preview-and-send one atomic run, or support resuming an approved snapshot.

### MAJOR 3 — Redaction rules are internally contradictory and export may leak

**Source:** Design Critic + Style

The path rule says "hash everything except basename" but the example preserves `project-x/src/index.ts`. The document acknowledges regex redaction misses connection strings and encoded tokens, yet `trace export` labels output as shareable. Residual values are persisted and exportable.

**Required fix:** Make path redaction match its rule. Use a structured allowlist for command arguments or strengthen the redaction pipeline. Treat traces as local-only; export with stricter sanitization and residual-risk warnings.

### MAJOR 4 — CLI interaction semantics incomplete

**Source:** Design Critic + Style

`--json` mode conflicts with interactive execution prompts. Non-TTY/CI behavior undefined. No `--yes`/`--no-exec` flags. Exit codes only defined for missing API key. `clean` alias justified by scripting but is functionally identical to interactive `scan`.

**Required fix:** Define TTY/non-TTY defaults, add explicit execution control flags, specify `--json` behavior, and document exit codes for all terminal states.

### MAJOR 5 — Causal and benefit claims exceed available evidence

**Source:** Design Critic + Style

Overview example says "This is the main reason your machine feels slow" but confidence contract classifies this as a hypothesis. Post-action 3-second sample cannot verify swap reclamation or Docker VM memory release.

**Required fix:** Use hedged language in examples. Label post-action results as short-term observations. Prohibit quantified expected savings unless locally calculated.

### MAJOR 6 — Payload tiering can omit stale dev-server candidates

**Source:** Design Critic

Stale dev servers are often low-CPU and modest-memory. They can fall into summary tiers lacking PID, lineage, and entity ID. The LLM cannot correlate them with listening ports or produce valid `EntityRef`s.

**Required fix:** Add a candidate tier for user-owned processes with listening ports, long runtime, or stale indicators. Or generate stale-process candidates locally and let the LLM explain only those.

### MAJOR 7 — `launchd` protection rule conflicts with stale-process detection

**Source:** Design Critic

"Managed by `launchd`" is undefined. If it means PPID 1, orphaned stale dev servers are protected when they match the stale profile. The collector does not gather service labels.

**Required fix:** Define "managed by launchd" operationally. Distinguish launchd-managed services from ordinary orphans reparented to PID 1.

### MAJOR 8 — Docker idle classification uses single-sample data for window threshold

**Source:** Structural + Style

`docker stats --no-stream` is one sample, but the threshold says "CPU < 2% over sampling window." The schema does not define multiple container samples.

**Required fix:** Either collect two Docker stats samples with interval calculation, or describe the threshold as instantaneous and weaken the classification.

### MAJOR 9 — Architecture diagram missing validator and confirmation flow

**Source:** Structural

The diagram branches from `LLM Analyzer` directly to `Reporter` and `Executor`. The validator and user confirmation step are absent. No `ValidatorResult`, user decision, or `ExecutionResult` contract defined.

**Required fix:** Update the diagram to show the full pipeline. Define typed contracts for each stage boundary.

### MAJOR 10 — Raw and redacted snapshot boundaries not modeled

**Source:** Structural

`SystemSnapshot` retains full process list locally; analyzer receives "redacted snapshot"; trace stores redacted only. No named `RedactedSnapshot` schema or statement of which components consume raw vs. redacted data.

**Required fix:** Define `RedactedSnapshot` schema explicitly. Document data flow: raw snapshot stays local, redacted snapshot goes to LLM, trace stores redacted.

### MAJOR 11 — SystemSnapshot nested types undefined; inconsistent collector status

**Source:** Structural + Style

`MachineInfo`, `MemoryStats`, `ProcessInfo`, `PortBinding`, `DockerState` referenced but not defined. Collector status listed as `complete/partial/failed` in one place, `complete/partial/failed/skipped/denied` in another.

**Required fix:** Define all nested types in the schema. List collector status enum once with a single name.

### MAJOR 12 — Analyzer/reporter contracts diverge by CLI mode

**Source:** Structural + Style + Design Critic

`DiagnosticReport` requires `recommendations`, but `explain` skips them. `--local-only` uses raw metrics. Only one analyzer schema defined. Top-level `confidence` undefined. `evidence_refs` is unspecified `string[]`.

**Required fix:** Define mode-specific schemas or specify that `explain` returns empty recommendations. Derive `confidence` from finding evidence levels or remove it.

### MAJOR 13 — Execution failure states undefined

**Source:** Structural

No behavior defined for Docker disappearing after validation, SIGTERM failing, SIGKILL needed, partial group kill, command timeout, or post-action sampling failure. No execution result schema or partial-run policy.

**Required fix:** Define an `ExecutionResult` schema with error categories, partial failure behavior, and exit codes.

### MAJOR 14 — Trace schema and write ownership unspecified

**Source:** Structural + Style

No event envelope, run ID, event type, or sequence number defined. User-confirmed target names may contain sensitive data conflicting with "redacted only" claim. Trace-write failure behavior undefined.

**Required fix:** Define a trace event schema. Sanitize user confirmation inputs. Specify what happens when trace writing fails.

### MAJOR 15 — `safe` terminology conflates general safety with specific risk level

**Source:** Style

Document promises "safe cleanup" and "safe targets" while also allowing `dangerous` actions to execute. "Safe" is used both as a product property and as a specific `risk_level` enum value.

**Required fix:** Use "allowlisted" or "guarded" for the execution model. Reserve "safe" for the specific risk level. Remove absolute claims like "without breaking anything."

### MAJOR 16 — `quit_app` missing from Overview and Goals action set

**Source:** Style + Design Critic

Overview and Goals mention only idle containers and stale dev servers, but schema and executor support `quit_app`. Product boundary unclear.

**Required fix:** Either remove `quit_app` or introduce the complete v1 action set in the Overview.

### MAJOR 17 — Docker VM correlation assumes brittle external behavior

**Source:** Design Critic

Assumes stable `Virtualization.VirtualMachine` process signature and `docker system info` fields. No supported-version matrix, fallback, or degradation behavior.

**Required fix:** State supported Docker Desktop versions. Use multiple detection strategies. Report incomplete correlation rather than letting LLM infer.

### NIT 1 — Architecture diagram says "macOS APIs" but implementation shells out

**Source:** Style

Diagram label implies native API integration; implementation uses system commands.

### NIT 2 — Technology stack says "openai (or provider SDK)" but config says OpenAI only

**Source:** Style

Creates uncertainty about provider neutrality in v1.

### NIT 3 — `clean` alias scripting rationale conflicts with interactive behavior

**Source:** Structural

`clean` is identical to `scan` including interactive prompts, but justified partly by scripting. Non-interactive behavior undefined.
