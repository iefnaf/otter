# Otter: LLM-Powered Mac Resource Diagnostic Tool

* **Author:** fanfei
* **Date:** 2026-10-30
* **Status:** Draft

## The Problem

macOS developers accumulate invisible resource waste over days or weeks of work. Docker Desktop reserves large chunks of memory whether or not containers are active. Dev servers from yesterday's debugging session keep listening on ports and holding memory. Swap files grow to 15GB without anyone noticing. By the time the machine feels slow, the cause is buried under hundreds of processes, containers, and system services.

Existing tools show *what* is consuming resources but not *why* it matters or *what to do about it*. Activity Monitor lists processes with CPU and memory numbers. Docker Desktop shows container status. Neither connects the dots between a Docker VM reserving 8GB, five idle containers inside it, swap climbing to 15GB, and a machine that has been up for 96 days. A developer who cannot interpret raw telemetry either ignores the problem, restarts everything, or asks an AI assistant to make sense of a manually pasted process list.

The gap is not data collection. The gap is **causal explanation and safe action**: a tool that looks at the whole system, explains in plain language what is wrong and why, and helps the user clean it up without breaking anything.

## Overview

Otter is a CLI tool for macOS developers. When a user feels their machine is slow or resource-constrained, they run `otter scan`. Otter collects a short system snapshot over a 2-10 second sampling window: CPU usage trends, memory pressure, swap state, process tree with lineage, listening ports, and Docker container status. It redacts sensitive data, sends the snapshot to an LLM, and produces a plain-language diagnostic report.

The report does three things Activity Monitor cannot:

1. **Explains causality.** Not "Docker is using 39% CPU" but "Docker Desktop's Linux VM reserved 8GB of your 16GB RAM. Five containers inside it are idle. Combined with 96 days of uptime and no reboot, swap has grown to 15GB. This is the main reason your machine feels slow."

2. **Identifies waste vs. legitimate work.** A video encoder using 90% CPU is normal. A Docker VM using 39% CPU with zero active containers is waste. Otter distinguishes these using process lineage, container state, port activity, and sampling trends.

3. **Proposes specific, safe cleanup actions.** Each recommendation shows exact targets, expected resource savings, risk level, and what else might be affected. The user confirms each action individually. Otter then executes only narrowly-scoped safe targets: idle containers, user-owned stale dev servers, processes with no active children.

Otter never runs as a background daemon. It never cleans without explicit per-action confirmation. It never executes against system processes, root-owned processes, or processes with active child dependencies. The LLM explains and recommends; local validated code decides what is safe to execute.

## Goals

* **Plain-language diagnosis.** Given a system snapshot, produce a report a developer can read in under 30 seconds and understand: what is wrong, why, and what to do.
* **Cross-system causal reasoning.** Connect Docker VM memory, container idle state, swap growth, process lineage, port staleness, and uptime into a coherent explanation rather than isolated metrics.
* **Safe execution.** After individual user confirmation, execute narrowly-scoped cleanup: stop idle containers, kill user-owned stale dev servers. Every action shows blast radius before confirmation and is revalidated immediately before execution.
* **Privacy by default.** Redact process arguments, project paths, and sensitive tokens before sending anything to an LLM. Show the user exactly what payload will leave their machine. Support a local-only mode.
* **Fast enough to be useful when it matters.** The tool runs when the machine is already under pressure. Total time from invocation to report should be under 60 seconds, with collection capped at 10 seconds.
* **Debuggable and auditable.** Every diagnostic run produces a local trace: what was collected, what was redacted, what the LLM said, what was validated, what the user confirmed, and what was executed.

## Non-Goals

* **No background monitoring.** Otter runs when the user asks it to. No daemon, no notifications, no thresholds, no continuous data collection.
* **No automatic cleanup.** Every action requires individual user confirmation. No blanket "clean all" button.
* **No system process termination.** Otter suggests but never executes against kernel processes, system daemons, root-owned processes, or processes with active children.
* **No free-form command generation.** The LLM returns structured recommendations from a fixed allowlist. It never generates shell commands. Local code validates and executes.
* **No cross-platform support in v1.** macOS only. Linux and Windows are future investigations.
* **No menu bar app in v1.** The CLI proves diagnosis quality first. A menu bar wrapper is a separate product decision after validation.
* **No general-user mode in v1.** Target is developers who understand processes, containers, and ports. General-user UX requires a different safety model.
* **No historical baselines in v1.** Otter diagnoses from a single on-demand sampling window. Trend baselines require persistent state and are deferred.

## Technical Plan

### Architecture Overview

Otter is a single CLI binary backed by a modular pipeline. Each stage is a separate module with a typed interface, testable in isolation, and versioned independently:

```text
┌──────────┐   ┌────────────┐   ┌──────────┐   ┌─────────────┐   ┌──────────────┐
│ Collector │──▶│ Normalizer │──▶│ Redactor │──▶│ LLM Analyzer│──▶│    Reporter   │
└──────────┘   └────────────┘   └──────────┘   └─────────────┘   └──────────────┘
  macOS APIs      typed schema     strip PII      structured       plain-language
  2-10s window    versioned        hash paths     JSON output     terminal output
                                                    │
                                                    ▼
                                              ┌──────────────┐
                                              │    Executor   │
                                              └──────────────┘
                                                allowlist only
                                                revalidate target
                                                per-action confirm
```

Every stage writes to an immutable **run trace** (JSONL file in `~/.otter/traces/`). The trace records inputs, outputs, timing, errors, and redaction decisions for every invocation. This makes bad reports debuggable and builds user trust.

### Technology Stack

**Language: TypeScript, compiled to a standalone binary via Bun.**

Rationale: TypeScript offers the fastest iteration loop for a tool that is mostly JSON transformation, system command orchestration, and LLM API calls. Bun compiles to a single ~90MB binary with no runtime dependencies. The user's existing codebase is TypeScript, reducing context switching. Rust would be faster at raw system calls but the bottleneck is LLM latency, not collection. Go is viable but offers no advantage over TypeScript for this use case.

**Key dependencies:**

| Purpose | Library | Why |
|---------|---------|-----|
| CLI framework | `commander` | Standard, subcommand support, option parsing |
| Interactive prompts | `@clack/prompts` | Modern confirmation UI, good keyboard UX |
| Terminal rendering | `picocolors` + `cli-table3` | Colored output, aligned tables |
| LLM client | `openai` (or provider SDK) | Structured output, JSON mode, streaming |
| Schema validation | `zod` | Runtime validation of LLM responses against typed schema |
| System interaction | `node:child_process` | Call `ps`, `lsof`, `sysctl`, `docker` |

### Data Collection Layer

The collector gathers data over a 2-10 second window (configurable via `--window`). It uses macOS system commands wrapped in typed adapters:

| Data | Command | Output |
|------|---------|--------|
| Process list | `ps -eo pid,ppid,user,%cpu,%mem,rss,vsz,etime,command` | Tab-separated, parsed into `ProcessInfo[]` |
| Process tree | Derived from `ppid` relationships | `ProcessNode` tree structure |
| Memory pressure | `memory_pressure` + `vm_stat` | `MemoryStats` with free/active/inactive/compressed/wired |
| Swap | `sysctl vm.swapusage` | Total, used, free |
| System load | `sysctl vm.loadavg` + `host_processor_info` | 1/5/15 min load averages, per-core CPU |
| Listening ports | `lsof -iTCP -sTCP:LISTEN -n -P` | `PortBinding[]` with PID, port, protocol |
| Docker containers | `docker ps --format json` + `docker stats --no-stream --format json` | `ContainerInfo[]` with state, CPU, memory |
| Uptime | `sysctl kern.boottime` | Boot timestamp, uptime duration |

Each collector adapter:

- Has a **timeout** (default 3s per source, 10s total collection budget)
- Reports **completeness status** (`complete`, `partial`, `failed`) with error details
- Produces a **typed, versioned** output object
- Is **testable in isolation** via fixture files (pre-captured command output)

If Docker is not running, the Docker collector reports `skipped` and the report notes "Docker not detected." If a permission error blocks `lsof`, the port collector reports `denied` and the report explains what was unavailable.

### Snapshot Schema

The normalizer combines collector outputs into a versioned `SystemSnapshot`:

```typescript
interface SystemSnapshot {
  schema_version: "1.0"
  collected_at: string          // ISO 8601
  collection_window_seconds: number
  machine: MachineInfo          // arch, cpu_cores, total_memory_gb, macos_version, uptime
  memory: MemoryStats           // free, active, inactive, compressed, wired, swap
  load: LoadStats               // 1/5/15 min averages, per-core usage over window
  processes: ProcessInfo[]      // top 100 by resource usage, with lineage
  ports: PortBinding[]          // listening TCP ports with owning PID
  docker: DockerState           // daemon status, containers with stats
  collector_status: CollectorStatus[]  // per-source completeness/errors
}
```

Only the top 100 processes are included (ranked by CPU × memory composite score) to bound LLM payload size. Process arguments are truncated to 200 characters. Paths are hashed, not sent raw.

### Redaction Layer

Before sending to the LLM, the redactor transforms the snapshot:

| Field | Redaction Rule |
|-------|---------------|
| Process command arguments | Regex-strip tokens matching API key patterns (`sk-`, `Bearer`, `--token`, `--key`), hash home directory and project paths |
| Usernames | Replace with `[USER]` |
| Hostnames / IPs | Replace with `[HOST]` / `[IP]` |
| Container names | Keep if generic (`redis`, `mysql`), hash if they contain project names or internal naming |
| Port numbers | Keep (needed for diagnosis, not sensitive alone) |
| File paths | Hash everything except basename (`~/worktrees/project-x/src/index.ts` → `…/project-x/src/index.ts`) |

The redacted payload is written to the run trace. The user can preview it with `otter scan --preview-payload` before sending.

### LLM Analyzer

The analyzer sends the redacted snapshot with a versioned prompt that instructs the model to:

1. Identify resource anomalies (things consuming more than expected for their type)
2. Explain causal chains (Docker VM + idle containers + no reboot → swap growth)
3. Distinguish legitimate work from waste (compiler using CPU = normal; idle dev server with stale port = waste)
4. Return recommendations in a strict JSON schema

**LLM response schema (validated with zod):**

```typescript
interface DiagnosticReport {
  summary: string                  // One-paragraph plain-language diagnosis
  findings: Finding[]              // Ranked list of resource issues
  recommendations: Recommendation[] // Ranked cleanup suggestions
  confidence: "high" | "medium" | "low"
}

interface Finding {
  id: string
  severity: "info" | "warning" | "critical"
  title: string                    // "Docker VM reserving 50% of RAM"
  explanation: string              // Plain language why this matters
  evidence_refs: string[]          // References to snapshot data points
}

interface Recommendation {
  id: string
  action_type: "stop_container" | "kill_process_group" | "quit_app"
  target_ref: string               // Reference to snapshot entity
  reason: string                   // Why this is safe and beneficial
  risk_level: "safe" | "caution" | "dangerous"
  expected_benefit: string         // "Frees ~8GB RAM, reduces swap pressure"
  blast_radius: string             // "Stops Docker VM; all containers will stop"
}
```

The LLM **never generates shell commands**. Recommendations reference snapshot entities by ID. Local code resolves these references to actual PIDs or container IDs.

If the LLM response fails schema validation or references nonexistent entities, the report falls back to a local summary ("LLM analysis failed validation, showing raw metrics") rather than displaying unverified content.

### Action Validator & Executor

After the LLM returns recommendations, local code validates each one:

1. **Schema check**: Recommendation conforms to the typed interface
2. **Target resolution**: `target_ref` maps to a real entity in the snapshot
3. **Safety check**: Target is not a system process, root-owned process, or parent with active children
4. **Revalidation**: Immediately before execution, re-check that the PID still exists with the same start time and command line, or the container still has the same ID and state

The user sees each recommendation individually with its risk level, blast radius, and expected benefit. They approve or reject each one via `@clack/prompts` confirmations. Dangerous actions require typing the target name to confirm.

Execution uses fixed code paths, not LLM-generated commands:

| Action | Implementation |
|--------|--------------|
| `stop_container` | `docker stop <container_id>` |
| `kill_process_group` | `process.kill(-pid, 'SIGTERM')`, wait 3s, then `SIGKILL` if still alive |
| `quit_app` | `osascript -e 'quit app "<name>"'` |

After execution, Otter collects a 3-second post-action sample to verify the expected resource improvement and reports it.

### CLI Interface

```bash
otter scan                    # Full diagnostic: collect → analyze → report
otter scan --json             # Machine-readable JSON report
otter scan --preview-payload  # Show what would be sent to LLM, don't send
otter scan --local-only       # Skip LLM, show raw local analysis only
otter scan --window 5         # Sampling window in seconds (default 3)

otter clean                   # Alias for scan with recommendations enabled
otter explain                 # Same as scan but skips recommendations

otter trace list              # List recent diagnostic runs
otter trace show <run-id>     # Show full trace for a run
otter trace export <run-id>   # Export trace as shareable JSON
```

### Run Trace Storage

Traces are stored in `~/.otter/traces/` as JSONL files, one per run:

```text
~/.otter/
  traces/
    2026-10-30T14-22-01_scan.jsonl    # One run, one file
    2026-10-30T15-01-33_scan.jsonl
  config.toml                           # API key, provider settings, preferences
```

Each trace contains: snapshot (pre-redaction reference), redacted payload, LLM request/response metadata, validated recommendations, user confirmations, execution results, post-action verification. Traces are local-only, never automatically uploaded. Auto-rotation keeps the last 100 runs.

## Alternatives Considered

### 1. Background daemon with threshold-based alerts

**What it means:** Otter runs as a system service, continuously monitoring CPU, memory, and swap. When thresholds are crossed, it sends a notification suggesting diagnosis.

**Why rejected:** Notification fatigue destroys trust — users learn to dismiss alerts without reading them. Continuous collection increases privacy exposure (process data constantly gathered even when not needed) and battery cost. Most critically, the user already knows when their machine feels slow; they do not need a threshold to tell them. The value is in on-demand depth, not in continuous watching.

**What survived:** The short sampling window concept. Otter still collects temporal data (2-10 seconds) to distinguish sustained load from spikes, but only when the user asks.

### 2. Rule-based detection engine (no LLM)

**What it means:** Otter uses predefined heuristics: "Docker VM exists + container CPU < 5% for all containers = suggest stopping Docker." "node process + port listening + uptime > 24h = likely stale dev server."

**Why rejected as primary approach:** Rule-based systems can only catch patterns the developer anticipated. They cannot explain novel situations (a Kubernetes sidecar leaking memory, a rogue Electron renderer, a build cache daemon gone wrong). They cannot generate natural explanations — they output template strings. The core value proposition is causal explanation of arbitrary system states, which requires reasoning, not matching.

**What survived:** Deterministic rules are used as a **validation layer**. After the LLM returns recommendations, local rules verify safety constraints: "Is this process user-owned? Does it have active children? Is this container actually idle?" The LLM explains; rules enforce boundaries.

### 3. Read-only diagnostic tool (no execution)

**What it means:** Otter only produces reports and prints suggested commands. The user copies and executes them manually.

**Why rejected:** Execution is the core differentiation. A read-only tool is a prettier Activity Monitor — users still have to do the work themselves. The product promise is "explain + fix," not "explain + suggest." Multiple reviewers recommended this approach for safety, but the safety concerns are addressable through allowlisting, per-action confirmation, and target revalidation without removing execution value.

**What survived:** The safety architecture from the read-only proposal became the execution guardrails. Every recommendation shows blast radius before confirmation. Every target is revalidated before action. Only narrow action types are supported.

### 4. Menu bar app first (no CLI)

**What it means:** Build a GUI menu bar application as the initial product, targeting a broader audience from day one.

**Why rejected:** Doubles development cost before core value (diagnosis quality) is validated. A GUI requires design decisions (notification UX, confirmation dialogs, accessibility) that depend on knowing what the diagnostic report looks like — which we do not know yet. The CLI iteration loop is faster: change prompt, run, evaluate output in seconds.

**What survived:** The menu bar app is Stage 4 in the rollout plan. The modular pipeline (collector, analyzer, reporter, executor as separate modules) is designed so a GUI can wrap the same core logic without rewriting it.

### 5. Broad system scan (collect everything possible)

**What it means:** Collect every available system metric: GPU usage, disk I/O, network throughput, battery health, thermal state, kernel extensions, login items, launch agents, and more.

**Why rejected:** More data does not produce better diagnoses — it produces noisier prompts, higher token costs, longer collection times, and more false positives. The diagnostic value comes from connecting a small set of highly relevant signals (CPU, memory, swap, processes, ports, Docker), not from exhaustive telemetry. Collection speed matters: the tool runs when the machine is already struggling.

**What survived:** The collector architecture is extensible. New data sources (GPU, disk I/O, thermal) can be added as separate adapters if diagnosis quality demonstrably improves with them.

## Detailed Implementation Plan

This plan lists every file needed for the MVP. The project lives in `otter/` as a standalone repository.

### Project Structure

```text
otter/
  package.json
  tsconfig.json
  bunfig.toml
  .gitignore
  README.md
  src/
    index.ts
    cli/
      commands/
        scan.ts
        trace.ts
    collectors/
      types.ts
      system.ts
      process.ts
      memory.ts
      ports.ts
      docker.ts
      index.ts
    snapshot/
      schema.ts
      builder.ts
    redactor/
      rules.ts
      redact.ts
    analyzer/
      prompt.ts
      llm.ts
      response.ts
    validator/
      safety.ts
      resolver.ts
      revalidate.ts
    executor/
      actions.ts
      verify.ts
    reporter/
      terminal.ts
      json.ts
    trace/
      types.ts
      store.ts
  tests/
    fixtures/
      ps-output.txt
      lsof-output.txt
      vm-stat-output.txt
      docker-ps.json
      docker-stats.json
      memory-pressure-output.txt
    collectors/
      process.test.ts
      memory.test.ts
      ports.test.ts
      docker.test.ts
    redactor/
      rules.test.ts
    analyzer/
      response.test.ts
    validator/
      safety.test.ts
```

### File-by-File Plan

#### Project Setup

| File | What Changes | Why |
|------|-------------|-----|
| `package.json` | Create. Define project name `otter`, version `0.1.0`, dependencies: `commander`, `@clack/prompts`, `picocolors`, `cli-table3`, `zod`, `openai`. Add scripts: `dev`, `build`, `test`. | Project manifest, dependency declaration, build/test entry points. |
| `tsconfig.json` | Create. Target ES2022, module ESNext, strict mode, outDir `./dist`. | TypeScript compilation config with full type checking. |
| `bunfig.toml` | Create. Set test preload for path aliases, configure build target as standalone binary. | Bun runtime and build configuration. |
| `.gitignore` | Create. Ignore `node_modules/`, `dist/`, `*.local`, `.env`, `coverage/`. | Prevent committing build artifacts and secrets. |
| `README.md` | Create. Project overview, install instructions, usage examples, development setup. | Entry point for GitHub visitors and new contributors. |

#### CLI Entry

| File | What Changes | Why |
|------|-------------|-----|
| `src/index.ts` | Create. Set up Commander program with `scan` and `trace` subcommands. Parse global options (`--json`, `--local-only`, `--preview-payload`, `--window`). Dispatch to command handlers. Exit with appropriate codes (0 = success, 1 = partial failure, 2 = fatal error). | Single entry point; routes CLI invocations to command logic. |
| `src/cli/commands/scan.ts` | Create. Orchestrate full pipeline: collect → normalize → redact → analyze (or skip with `--local-only`) → validate → report → optionally confirm and execute. Manage timing budget across stages. Handle SIGINT gracefully (save partial trace). | Core diagnostic workflow; the only command most users interact with. |
| `src/cli/commands/trace.ts` | Create. Subcommands: `list` (show recent runs), `show <id>` (display full trace), `export <id>` (output as JSON). Read from trace store. | Debugging and audit trail access. |

#### Collectors

| File | What Changes | Why |
|------|-------------|-----|
| `src/collectors/types.ts` | Create. Define `Collector<T>` interface: `name`, `timeout_ms`, `collect(): Promise<CollectorResult<T>>` where `CollectorResult` has `status: complete/partial/failed/skipped`, `data: T \| null`, `error: string \| null`, `duration_ms: number`. Define all data type interfaces: `ProcessInfo`, `MemoryStats`, `PortBinding`, `ContainerInfo`, `MachineInfo`, `LoadStats`. | Shared contract for all collectors; enables testing with fixtures. |
| `src/collectors/system.ts` | Create. Collect machine info (arch, CPU cores, total RAM, macOS version) via `sysctl`. Collect uptime via `sysctl kern.boottime`. Collect load averages via `sysctl vm.loadavg`. | Baseline machine context needed for diagnosis. |
| `src/collectors/process.ts` | Create. Run `ps -eo pid,ppid,user,%cpu,%mem,rss,etime,command` twice with `window` seconds between samples. Parse output into `ProcessInfo[]`. Compute CPU delta between samples for sustained vs. spike detection. Build process tree from `ppid` relationships. Rank by composite score (CPU × memory). Return top 100. | Primary diagnostic data; two samples distinguish sustained load. |
| `src/collectors/memory.ts` | Create. Run `memory_pressure` for percentage, `vm_stat` for page-level detail, `sysctl vm.swapusage` for swap state. Parse into `MemoryStats` with free, active, inactive, compressed, wired, swap total/used. | Memory pressure is the most common Mac slowdown cause. |
| `src/collectors/ports.ts` | Create. Run `lsof -iTCP -sTCP:LISTEN -n -P`. Parse into `PortBinding[]` with PID, port, protocol, process name. Handle permission-denied gracefully (report `partial`). | Identifies stale dev servers and service conflicts. |
| `src/collectors/docker.ts` | Create. Check if Docker daemon is reachable via `docker info --format json`. If reachable, run `docker ps --format json` and `docker stats --no-stream --format json`. Map containers to host processes via Docker Desktop's VM process. If Docker unavailable, report `skipped`. | Docker is the single largest resource consumer in typical developer setups. |
| `src/collectors/index.ts` | Create. Orchestrate all collectors in parallel with `Promise.allSettled`. Enforce total budget (default 10s). Return `CollectionResult` with per-collector status. | Single entry point for collection; parallel execution minimizes wall time. |

#### Snapshot

| File | What Changes | Why |
|------|-------------|-----|
| `src/snapshot/schema.ts` | Create. Define `SystemSnapshot` Zod schema matching the design doc. Export both Zod schema and inferred TypeScript type. Version field: `schema_version: "1.0"`. | Single source of truth for snapshot structure; used for validation and documentation. |
| `src/snapshot/builder.ts` | Create. Accept `CollectionResult`, combine into `SystemSnapshot`. Add `collected_at` timestamp, `collection_window_seconds`. Validate against schema before returning. | Transforms raw collector outputs into the versioned snapshot the rest of the pipeline uses. |

#### Redactor

| File | What Changes | Why |
|------|-------------|-----|
| `src/redactor/rules.ts` | Create. Define redaction rules as data: API key patterns (regex for `sk-`, `Bearer`, `token=`, `key=`), hostname/IP patterns, home directory pattern, path truncation rule. Each rule has `name`, `pattern`, `replacement`, `description`. | Rules as data enables testing and user preview ("these transformations will be applied"). |
| `src/redactor/redact.ts` | Create. Accept `SystemSnapshot`, apply rules to process command arguments, user names, hostnames, file paths. Return `RedactedSnapshot` plus list of applied transformations. Never mutate the original. | Privacy boundary; produces the exact payload that leaves the machine. |

#### Analyzer

| File | What Changes | Why |
|------|-------------|-----|
| `src/analyzer/prompt.ts` | Create. Export versioned prompt template. Include: system context, diagnostic instructions, output format specification, few-shot examples of good causal explanations. Prompt version tracked in trace. | Prompt is versioned content; changing it changes analysis behavior and must be traceable. |
| `src/analyzer/llm.ts` | Create. Wrap OpenAI SDK. Accept `RedactedSnapshot`, send to model with JSON mode enabled, return raw response. Handle timeout (30s), retry (1 retry on rate limit), and connection errors. Record token usage and latency. | Isolated LLM client; swap providers by changing this file only. |
| `src/analyzer/response.ts` | Create. Define Zod schema for `DiagnosticReport`, `Finding`, `Recommendation`. Validate LLM response. Check that all `evidence_refs` point to real snapshot entities. Check that all `target_ref` values resolve. Return validated report or structured error. | Ensures LLM output is trustworthy before display; blocks hallucinated targets. |

#### Validator

| File | What Changes | Why |
|------|-------------|-----|
| `src/validator/safety.ts` | Create. Given a `Recommendation` and the current `SystemSnapshot`, check: target is user-owned (not root/system), target has no active child processes (for kill actions), container is actually idle (for stop actions), process is not managed by launchd. Return pass/fail per check with reasons. | Deterministic local safety checks independent of LLM judgment. |
| `src/validator/resolver.ts` | Create. Given a `target_ref` string, resolve to concrete PID or container ID by looking up snapshot entities. Return `ResolvedTarget` with full identity (PID, start time, command line, container ID). | Bridges LLM abstract references to concrete system targets. |
| `src/validator/revalidate.ts` | Create. Immediately before execution, re-run minimal collection: check PID exists, start time matches, command line matches, container ID and state unchanged. Return `RevalidationResult` (ok / target_changed / target_gone). | Prevents TOCTOU attacks and stale-snapshot mistakes. |

#### Executor

| File | What Changes | Why |
|------|-------------|-----|
| `src/executor/actions.ts` | Create. Implement three actions with fixed code paths: `stopContainer(containerId)` → `docker stop`, `killProcessGroup(pid)` → SIGTERM then SIGKILL after 3s, `quitApp(name)` → `osascript`. Each action logs start/end/result to trace. No shell interpolation of LLM content. | The only code that touches the system destructively; must be minimal and fixed. |
| `src/executor/verify.ts` | Create. After action, wait 3 seconds, re-collect memory and process state, compare against pre-action snapshot. Report freed memory, stopped processes, remaining pressure. | Verifies the action achieved its stated benefit; catches supervised processes that respawned. |

#### Reporter

| File | What Changes | Why |
|------|-------------|-----|
| `src/reporter/terminal.ts` | Create. Render diagnostic report to terminal: summary paragraph, findings table (severity-colored), recommendations with risk badges and blast radius, confirmation prompts via `@clack/prompts`. | Primary user-facing output; readability is the product. |
| `src/reporter/json.ts` | Create. Serialize report to JSON for `--json` mode. Include all fields from `DiagnosticReport` plus execution results if actions ran. | Machine-readable output for scripting and CI. |

#### Trace

| File | What Changes | Why |
|------|-------------|-----|
| `src/trace/types.ts` | Create. Define `TraceEvent` union type: `CollectionStarted`, `CollectionCompleted`, `RedactionApplied`, `LLMRequestSent`, `LLMResponseReceived`, `RecommendationsValidated`, `UserConfirmed`, `ActionExecuted`, `ActionVerified`, `RunCompleted`. Each event has timestamp and run ID. | Typed event schema for the audit trail. |
| `src/trace/store.ts` | Create. Write events to `~/.otter/traces/<run-id>.jsonl` (append mode). Implement `list()`, `show(id)`, `export(id)`. Auto-rotate: keep newest 100 files, delete older. | Persistent local audit; users can debug and share runs. |

#### Tests and Fixtures

| File | What Changes | Why |
|------|-------------|-----|
| `tests/fixtures/ps-output.txt` | Create. Pre-captured `ps -eo` output from a real developer machine (redacted). | Test process collector against realistic data. |
| `tests/fixtures/lsof-output.txt` | Create. Pre-captured `lsof` output. | Test port collector. |
| `tests/fixtures/vm-stat-output.txt` | Create. Pre-captured `vm_stat` output. | Test memory collector. |
| `tests/fixtures/docker-ps.json` | Create. Pre-captured `docker ps --format json`. | Test Docker collector. |
| `tests/fixtures/docker-stats.json` | Create. Pre-captured `docker stats --format json`. | Test Docker stats parsing. |
| `tests/fixtures/memory-pressure-output.txt` | Create. Pre-captured `memory_pressure` output. | Test memory pressure parsing. |
| `tests/collectors/process.test.ts` | Create. Test `ps` output parsing: correct field extraction, CPU delta calculation, process tree building, top-N ranking. | Process data is the highest-risk parsing target. |
| `tests/collectors/memory.test.ts` | Create. Test `vm_stat` and `memory_pressure` parsing: correct unit conversion, swap extraction. | Memory stats drive the most common recommendations. |
| `tests/collectors/ports.test.ts` | Create. Test `lsof` parsing: PID extraction, port matching, permission-denied handling. | Port data identifies stale dev servers. |
| `tests/collectors/docker.test.ts` | Create. Test Docker CLI output parsing, daemon-unavailable handling, container-to-process mapping. | Docker data is a primary diagnosis source. |
| `tests/redactor/rules.test.ts` | Create. Test each redaction rule: API keys stripped, paths hashed, usernames replaced. Verify no original sensitive data appears in output. | Privacy is a launch requirement; must be tested. |
| `tests/analyzer/response.test.ts` | Create. Test LLM response validation: valid report passes, malformed JSON fails, hallucinated target refs rejected, missing evidence refs rejected. | Prevents unvalidated LLM output from reaching users. |
| `tests/validator/safety.test.ts` | Create. Test safety checks: root process rejected, system process rejected, process with children rejected, idle container approved. | Prevents dangerous executions. |

### Implementation Order

Build in this sequence, with each step producing a testable artifact:

1. **Project scaffold**: `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore`, `README.md`, `src/index.ts` with stub commands. Verify: `otter --help` works.
2. **System + process collectors**: `collectors/types.ts`, `system.ts`, `process.ts`, `memory.ts`. Fixture tests for parsing. Verify: `otter scan --local-only --json` produces a snapshot.
3. **Ports + Docker collectors**: `ports.ts`, `docker.ts`, fixture tests. Verify: snapshot includes port and Docker data.
4. **Snapshot schema + builder**: `snapshot/schema.ts`, `builder.ts`. Verify: full snapshot validates against Zod schema.
5. **Redactor**: `redactor/rules.ts`, `redact.ts`, tests. Verify: `otter scan --preview-payload` shows redacted output.
6. **LLM analyzer**: `analyzer/prompt.ts`, `llm.ts`, `response.ts`. Verify: `otter scan` produces a plain-language report.
7. **Validator**: `validator/safety.ts`, `resolver.ts`, `revalidate.ts`, tests. Verify: recommendations with unsafe targets are rejected.
8. **Reporter**: `reporter/terminal.ts`, `json.ts`. Verify: terminal output is readable, JSON output is valid.
9. **Executor**: `executor/actions.ts`, `verify.ts`. Verify: confirmed actions execute against test containers.
10. **Trace**: `trace/types.ts`, `store.ts`. Verify: `otter trace list` and `otter trace show` work.
