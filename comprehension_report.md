# Stage 6: Comprehension Test

* **Target:** `design_draft.md`
* **Reviewer:** egm-comprehension
* **Date:** 2026-10-30
* **Mode:** Interactive full flow

## Paraphrase of FeatureRange (lines 1-285)

Otter is proposed as an on-demand macOS CLI for developers whose machines feel slow: `otter scan` takes a short system sample, redacts sensitive details, sends the resulting snapshot to an LLM, and returns a concise explanation of likely causes and cleanup options. Its intended differentiator is correlation rather than raw telemetry — linking Docker VM memory, idle containers, stale user processes, listening ports, swap, uptime, and process lineage into a causal story. It also aims to separate legitimate heavy work from waste and to make cleanup safer through fixed action types, local validation, per-action confirmation, blast-radius disclosure, and immediate target revalidation. Privacy, bounded latency, local traces, and explicit non-goals — no daemon, automatic cleanup, system-process termination, arbitrary command generation, cross-platform support, GUI, general-user mode, or historical baselines — are central to the proposal. The rejected alternatives preserve selected ideas: short sampling, deterministic safety checks, execution guardrails, a reusable modular core for a later GUI, and extensible collectors without broad indiscriminate telemetry.

## Paraphrase of DetailedRange (lines 286-471)

The implementation is planned as a standalone TypeScript/Bun repository under `otter/`, beginning with project configuration, a README, and a Commander-based CLI entry point. Separate collector modules gather machine, process, memory, port, and Docker data in parallel under a shared timeout and status model; a snapshot module combines and validates their outputs using Zod. The remaining pipeline redacts the snapshot, sends it through a versioned prompt and OpenAI SDK wrapper, validates the structured LLM response, resolves and safety-checks recommended targets, revalidates them immediately before execution, and executes only three fixed action implementations. Reporter modules render human-readable and JSON output, while a JSONL trace store records lifecycle events and rotates old runs. Fixture-based tests cover the main parsers, redaction, LLM-response validation, and safety checks, with implementation ordered from scaffold and collectors through snapshot, redaction, analysis, validation, reporting, execution, and tracing.

## Findings

- **HIGH — LLM setup and configuration are unspecified:** The design depends on an LLM provider but never defines supported providers, model selection, authentication setup, first-run configuration, API-key storage security, or behavior when no key is configured. A new contributor could implement the wrapper but would not know how to configure or run the normal diagnostic path.

- **HIGH — Local-only mode has no defined analysis contract:** `--local-only` is described as skipping the LLM and showing "raw local analysis," but no local analyzer, local diagnostic format, local recommendation behavior, or corresponding implementation file is specified. A reader must ask whether this mode is merely raw metrics, whether it produces causal findings, and whether it can recommend actions.

- **HIGH — Snapshot entity references lack a stable ID contract:** `target_ref` and `evidence_refs` are required, and hallucinated references must be rejected, but the document does not define entity ID formats, where those IDs are assigned, or how they remain stable between snapshot creation, validation, revalidation, and execution. This is especially unclear because `ProcessInfo` fields are never fully specified.

- **HIGH — Safety depends on undefined notions of "idle," "stale," and "active":** The product repeatedly distinguishes idle containers, stale servers, active children, and active containers, but supplies no thresholds, state rules, time windows, or measurement definitions. Since these classifications determine whether destructive actions are offered, a fresh implementer cannot reproduce the intended safety behavior.

- **HIGH — The top-100 process limit conflicts with child-safety checks:** The snapshot retains only the top 100 processes, yet execution safety requires proving that a target has no active children and the design claims process lineage is available. Children outside the selected set may be invisible, so the document needs to say whether lineage closure is collected separately, whether all processes are retained internally, or how the safety check avoids relying on the truncated snapshot.

- **HIGH — Dangerous actions appear executable despite the safety promise:** The architecture says Otter executes only safe, narrowly scoped targets, while the recommendation schema allows `dangerous` and the UI describes typed confirmation for dangerous actions. The document must state whether dangerous recommendations are display-only, blocked by validation, or executable after stronger consent.

- **HIGH — Redaction rules are internally inconsistent:** One section says project paths are hashed and process arguments are stripped or truncated; another shows a path with the project name and source directories retained. The plan also omits detailed rules for usernames and project-derived container names despite listing them earlier. A fresh contributor cannot determine the exact outbound payload or how sensitive values following `--token`, `--key`, or `Bearer` are removed.

- **HIGH — Trace export may contradict privacy by default:** Traces contain a pre-redaction snapshot reference and can be exported as "shareable JSON," but the document does not explain whether export redacts raw process arguments, paths, hostnames, tokens, or user identifiers. Without an explicit export policy, the audit feature can bypass the outbound-data protections.

- **HIGH — Docker causality is not supported by the described inputs:** The desired explanation concerns the Docker Desktop VM's reserved memory and CPU, but the collectors only describe Docker daemon status, containers, container stats, and a vague mapping to the Docker Desktop VM process. The document does not explain how VM reservation, idle containers, and host-process resource usage are correlated or how container-to-host-process mapping works.

- **MEDIUM — Process identity and revalidation data are incomplete:** Revalidation compares PID, process start time, and command line, but the listed `ps` fields do not include a robust start-time field and only describe `etime`. The document also says to calculate CPU delta from two `ps` samples even though `ps %cpu` is not naturally an interval delta without a defined calculation.

- **MEDIUM — `quit_app` has an unclear safety and resolution path:** The executor supports quitting an application by name, but the snapshot has no explicit application entity, `target_ref` format for apps is undefined, and the validator describes checks mainly for processes and containers. The reader must ask how an app name is validated and how blast radius is determined.

- **MEDIUM — `scan`, `clean`, and `explain` overlap ambiguously:** `clean` is called an alias for scan with recommendations enabled, while `scan` already appears to produce recommendations and `explain` explicitly skips them. The document should state whether recommendations and interactive execution are enabled by default in `scan`.

- **MEDIUM — Collector status vocabularies conflict:** The feature plan introduces a `denied` status for blocked `lsof`, while the detailed `CollectorResult` type permits only `complete`, `partial`, `failed`, and `skipped`. Implementers need one canonical state model and a mapping from permission denial to that state.

- **MEDIUM — macOS permission prerequisites are not documented:** The tool invokes process, port, Docker, and application-quit interfaces, but the document does not tell a new user which macOS privacy permissions, Docker Desktop settings, developer tools, or terminal capabilities are required. It handles denial after the fact but does not define setup or degraded-mode guidance.

- **MEDIUM — Per-core CPU collection is promised but not planned:** The feature schema expects per-core usage over the sampling window and names `host_processor_info`, while the detailed system collector only lists `sysctl` calls for machine metadata, uptime, and load averages. No file or adapter is specified to collect per-core samples.

- **LOW — The "every file needed for the MVP" claim is not fully supported:** The file plan omits configuration loading, local-only analysis, `clean`/`explain` command definitions, redacted-snapshot schema details, and tests for the executor, reporter, snapshot builder, CLI orchestration, and trace store. This does not block understanding of the architecture, but it does make the MVP boundary unclear.

- **LOW — Implementation order produces an unvalidated snapshot initially:** Step 2 says `--local-only --json` should produce a snapshot before step 4 creates and validates the snapshot schema. The document should clarify whether step 2 uses a provisional schema or merely raw collector output.
