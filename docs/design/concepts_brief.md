# Otter: LLM-Powered Mac Resource Diagnostic Tool

* **Author:** fanfei
* **Date:** 2026-10-29

## Overview

A CLI tool for macOS developers named **Otter**. Otters are clever, dexterous, and keep their environment tidy. When run, Otter collects a short system snapshot (CPU, memory, swap, process tree, ports, Docker state), sends a redacted version to an LLM, and returns a plain-language diagnostic report. The report explains what is consuming resources, which usage is abnormal, what can be safely cleaned up, and what the blast radius of each cleanup action would be. Users confirm cleanup actions individually; Otter executes only narrowly-scoped safe targets.

## Analysis

Six review lenses reached a strong consensus on three structural problems with the original framing.

**The original "monitor and clean up" framing is the wrong starting point.** Existing tools already cover visibility and manual cleanup: Activity Monitor shows resource usage, Docker Desktop shows container state, `htop` and Stats provide developer-oriented monitoring. A tool that merely renames this data in plain English adds little value. The defensible wedge is narrower: cross-system causal diagnosis with safe blast-radius explanation — connecting Docker VM memory reservation, swap accumulation, forgotten dev servers, and process lineage into one coherent explanation that helps users make better decisions.

**A single instant snapshot cannot support reliable diagnosis.** One observation shows *what* is using resources but not *why* — whether usage is a healthy transient spike, a leak, expected build behavior, or a stalled process. The tool needs a short on-demand sampling window (seconds, not minutes), not a single `top -l 1` call.

**LLM-driven execution is the highest-risk component and needs strict guardrails, not removal.** Killing a process or stopping a container can destroy unsaved work, interrupt deployments, corrupt stateful services, or break dependencies. The original reviewers suggested deferring execution to a later version, but execution is the core product differentiation — without it, the tool degrades to a diagnostic report. The resolution is to keep execution in v1 behind a narrow safety architecture described below.

### Critical Requirements (all reviewers)

- **Execution must go through a deterministic local action compiler.** The LLM returns structured recommendations only (`stop_container`, `kill_process_group`, `quit_app`). Local code maps these to a fixed allowlist, validates targets independently, re-checks process identity (PID + start time + command line) immediately before execution, and refuses anything unverifiable. The LLM never generates shell commands.
- **Confirmation must be per-action, not blanket.** Each cleanup group shows exact targets, expected benefit, risk level (safe / caution / dangerous), and blast radius. Dangerous actions require additional explicit confirmation. The tool never offers a one-click "clean everything" button.
- **Default execution scope is narrowly safe.** The tool auto-executes only clearly safe targets: idle Docker containers, user-owned dev servers with stale listening ports, processes with no child dependencies. System processes, root-owned processes, and parent processes with active children are suggested but never executed without manual intervention.
- **Privacy and redaction must be designed before launch, not added later.** Process command lines, project paths, container names, ports, and environment-adjacent metadata can contain tokens, internal hostnames, proprietary project names, and personal context. The tool must redact at collection time, show users exactly what will be sent, and support a local-only mode.
- **The LLM must never emit executable commands.** The model returns structured JSON with evidence references. Local code validates every recommendation against the current snapshot, checks target liveness and identity, and rejects anything unverifiable. The LLM explains; it does not control.
- **Every diagnostic run needs an immutable local trace.** The trace records what was collected, what was redacted, what the LLM said, what was validated, and what the user saw. This makes bad reports debuggable and builds trust.
- **Stale snapshots must never drive actions.** Between collection, analysis, and confirmation, PIDs can exit and be reused. Any future execution feature must revalidate target identity (PID + start time + command line + parent) immediately before acting.
- **Collection must be bounded.** The tool runs when the machine is already under pressure. It must cap collection duration, process count, prompt size, and its own resource overhead.

## Goals vs. Non-Goals

* **In-Scope Goals:**
    * Read-only diagnostic CLI for macOS
    * Short sampling window (2-10 seconds) of CPU, memory, swap, top processes, process lineage
    * Optional Docker container state collection
    * Local redaction with user-visible payload preview
    * LLM-powered plain-language report explaining resource usage and anomalies
    * Suggested cleanup actions with risk level, expected benefit, and blast radius
    * Confirmed execution of narrowly-scoped safe actions (idle containers, user-owned stale dev servers)
    * Per-action confirmation with blast-radius display before any execution
    * Target revalidation immediately before execution (PID + start time + command line)
    * Local run trace for debugging
    * Versioned snapshot and report schemas

* **Out-of-Scope Non-Goals:**
    * No background daemon or persistent monitoring
    * No automatic cleanup without explicit per-action confirmation
    * No execution against system processes, root-owned processes, or parent processes with active children
    * No free-form shell command generation or execution
    * No Linux/Windows support in v1
    * No menu bar app until CLI diagnosis quality is validated
    * No general-user mode until developer value is proven
    * No historical baseline tracking in v1

## Alternatives Weighed

* **Background daemon with threshold-based alerts.** Rejected: creates notification fatigue, privacy exposure, and battery cost. Users initiate diagnosis when they feel the problem — the tool does not need to watch continuously.
* **Rule-based detection engine.** Rejected as primary approach: can only catch pre-programmed patterns, cannot explain novel situations. Retained as a validation layer: deterministic local rules check LLM recommendations before display.
* **Immediate execution with blanket confirmation.** Rejected: one-click "clean everything" becomes click-through when users do not understand consequences. Replaced by per-action confirmation with blast-radius display and pre-execution target revalidation.
* **Full GUI menu bar app first.** Rejected: doubles development cost before core value (diagnosis quality) is validated. CLI proves the concept faster.
* **Broad system scan (everything collectable).** Rejected: increases privacy exposure, token cost, latency, and false positives. MVP collects the minimum causal chain: system pressure, top processes over a window, memory/swap trend, and relevant user-owned services.

## Key Decisions & Staging for Next Steps

1. **Execution stays in v1 behind guardrails.** The core value is "explain + fix," not just "explain." Safety comes from the action allowlist, per-action confirmation, narrow default scope, and pre-execution revalidation — not from removing execution.
2. **Short sampling window over instant snapshot.** A 2-10 second window distinguishes sustained load from transient spikes and gives the LLM enough context to reason about causality.
3. **LLM explains; local code validates.** The model receives a redacted, versioned snapshot and returns structured JSON with evidence references. Local validators check every claim against the snapshot before rendering the report.
4. **Privacy is a launch requirement.** Redaction at collection time, user-visible payload preview, and local-only mode are not post-MVP features.
5. **Staged rollout:**
    * Stage 1: Read-only snapshot + plain-language report + suggested actions (printed, not executed)
    * Stage 2: Allowlisted execution with per-action confirmation and target revalidation
    * Stage 3: Broader action coverage (process groups, compose projects) as safety record builds
    * Stage 4: Menu bar app wrapping the stabilized CLI contract
6. **Success metric:** Whether the report changes the user's decision compared to Activity Monitor, Docker Desktop, and a manual LLM conversation. Not the amount of data collected.
