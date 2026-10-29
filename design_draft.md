# Otter: LLM-Powered Mac Resource Diagnostic Tool

* **Author:** fanfei
* **Date:** 2026-10-30
* **Status:** Draft

## The Problem

macOS developers accumulate invisible resource waste over days or weeks of work. Docker Desktop reserves large chunks of memory whether or not containers are active. Dev servers from yesterday's debugging session keep listening on ports and holding memory. Swap files grow to 15GB without anyone noticing. By the time the machine feels slow, the cause is buried under hundreds of processes, containers, and system services.

Existing tools show *what* is consuming resources but not *why* it matters or *what to do about it*. Activity Monitor lists processes with CPU and memory numbers. Docker Desktop shows container status. Neither connects the dots between a Docker VM reserving 8GB, five idle containers inside it, swap climbing to 15GB, and a machine that has been up for 96 days. A developer who cannot interpret raw telemetry either ignores the problem, restarts everything, or asks an AI assistant to make sense of a manually pasted process list.

The gap is not data collection. The gap is **causal explanation and guarded action**: a tool that looks at the whole system, explains in plain language what is wrong and why, and helps the user clean it up with explicit blast-radius disclosure and per-action confirmation.

## Overview

Otter is a CLI tool for macOS developers. When a user feels their machine is slow or resource-constrained, they run `otter scan`. Otter collects a short system snapshot over a 2-10 second sampling window: CPU usage trends, memory pressure, swap state, process tree with lineage, listening ports, and Docker container status. It redacts sensitive data, sends the snapshot to an LLM, and produces a plain-language diagnostic report.

The report does three things Activity Monitor cannot:

1. **Explains causality.** Not "Docker is using 39% CPU" but "Docker Desktop's Linux VM reserved 8GB of your 16GB RAM. Five containers inside it are idle. Combined with 96 days of uptime and no reboot, swap has grown to 15GB. The evidence suggests this is a likely main contributor to slowness."

2. **Identifies waste vs. legitimate work.** A video encoder using 90% CPU is normal. A Docker VM using 39% CPU with zero active containers is waste. Otter distinguishes these using process lineage, container state, listening port status, and sampling trends.

3. **Proposes specific, guarded cleanup actions.** Each recommendation shows exact targets, expected resource savings, locally-derived risk level, and what else might be affected. The user confirms each action individually. Otter then executes only allowlisted targets: idle containers and user-owned stale dev servers with no active children.

Otter never runs as a background daemon. It never cleans without explicit per-action confirmation. It never executes against system processes, root-owned processes, or processes with active child dependencies. The LLM explains and recommends; local validated code decides what is guarded enough to execute.

## Goals

* **Plain-language diagnosis.** Given a system snapshot, produce a report a developer can read in under 30 seconds and understand: what is wrong, why, and what to do.
* **Cross-system causal reasoning.** Connect Docker VM memory, container idle state, current swap usage, process lineage, listening ports, and uptime into a coherent explanation rather than isolated metrics.
* **Guarded execution.** After individual user confirmation, execute narrowly-scoped cleanup: stop containers explicitly labeled as disposable, kill user-owned stale dev servers. Every action shows blast radius before confirmation and is revalidated immediately before execution. Risk levels are derived from local system facts, not LLM output.
* **Privacy by default.** Redact process arguments, project paths, and sensitive tokens before sending anything to an LLM. Show the user exactly what payload will leave their machine. Support a local-only mode.
* **Fast enough to be useful when it matters.** The tool runs when the machine is already under pressure. Total time from invocation to report should be under 60 seconds. The global run deadline is 45s; collection is capped at 15s; LLM analysis gets the remaining budget. Retries only if they fit within the global deadline.
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

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Privacy leakage via process arguments | High | Regex redaction + path hashing + payload preview + strict trace export (omits arguments). Residual risk documented. |
| Wrong-target execution | High | PID + start_time + command_line revalidation immediately before action. `target_changed` aborts. |
| LLM prompt injection via process/container names | High | LLM output validated against schema. Risk level derived locally, never from LLM. No shell command generation. |
| LLM API outage or rate limit | Medium | `--local-only` mode always works. 30s timeout, 1 retry on rate limit, graceful fallback to raw metrics. |
| Partial collection due to permissions | Medium | Each collector reports `denied`/`partial` status. Report explains what was unavailable. Diagnosis quality degrades visibly. |
| Docker Desktop version incompatibility | Medium | Three VM detection strategies with fallback. `unknown` state tells LLM not to infer. |
| Payload exceeds LLM context window | Medium | Three-tier payload (detail/candidate/summary) caps token usage. Summary tier compresses low-relevance processes. |
| Process group contains unrelated processes | High | v1 kills only the validated single PID, never the process group. Group semantics deferred to a future version. |
| Stale dev server is actually needed | Medium | Per-action confirmation shows blast radius. User must explicitly approve. `caution` risk requires expanded display. |
| Trace file disk usage | Low | Auto-rotation keeps last 100 runs. JSONL format is compact. `0700` directory permissions. |


## Technical Plan

### Architecture Overview

Otter is a single CLI binary backed by a modular pipeline. Each stage is a separate module with a typed interface, testable in isolation, and versioned independently:

```text
┌──────────┐   ┌────────────┐   ┌──────────┐   ┌─────────────┐   ┌──────────┐
│ Collector │──▶│ Normalizer │──▶│ Redactor │──▶│ LLM Analyzer│──▶│ Validator │
└──────────┘   └────────────┘   └──────────┘   └─────────────┘   └──────────┘
  macOS system    typed schema     strip PII      structured       local safety
  commands        versioned        hash paths     JSON output      + risk classify
                                                                        │
                                                                        ▼
┌──────────┐   ┌──────────┐   ┌────────────┐              ┌──────────────────┐
│ Reporter │◀──│ Verifier │◀──│  Executor  │◀───confirm──│ User Confirmation │
└──────────┘   └──────────┘   └────────────┘              └──────────────────┘
  plain-language  post-action     allowlisted     per-action prompt    y/n or
  terminal output sample          fixed actions   (TTY) or --yes      typed name

  Every stage writes sanitized events to: ~/.otter/traces/<run-id>.jsonl
```

Every stage writes sanitized events to an immutable **run trace** (JSONL file in `~/.otter/traces/`). The trace records sanitized stage inputs and outputs, timing, errors, and redaction decisions. Full LLM prompts and responses are stored in redacted form. This makes bad reports debuggable without persisting sensitive data.

### Diagnosis Confidence Contract

Otter's report distinguishes three evidence levels. Every finding must state which level it operates at:

- **Measured fact**: A value directly observed in the snapshot (e.g., "Docker VM process uses 1.2GB RSS", "swap usage is 11GB").
- **Supported hypothesis**: A causal claim where the evidence is present but not conclusive (e.g., "swap accumulation is likely driven by Docker's 8GB reservation combined with 96 days of uptime").
- **Unsupported inference**: A pattern the LLM recognizes but the snapshot cannot confirm (e.g., "this process may be a stale dev server").

The LLM prompt requires each finding to carry an `evidence_level` field. The reporter renders unsupported inferences with visible hedging ("possibly", "may indicate") and never attaches executable recommendations to them.

### Technology Stack

**Language: TypeScript, compiled to a standalone binary via Bun.**

Rationale: TypeScript offers the fastest iteration loop for a tool that is mostly JSON transformation, system command orchestration, and LLM API calls. Bun compiles to a single ~90MB binary with no runtime dependencies. The user's existing codebase is TypeScript, reducing context switching. Rust would be faster at raw system calls but the bottleneck is LLM latency, not collection. Go is viable but offers no advantage over TypeScript for this use case.

**Key dependencies:**

| Purpose | Library | Why |
|---------|---------|-----|
| CLI framework | `commander` | Standard, subcommand support, option parsing |
| Interactive prompts | `@clack/prompts` | Modern confirmation UI, good keyboard UX |
| Terminal rendering | `picocolors` + `cli-table3` | Colored output, aligned tables |
| LLM client | `openai` | Structured output, JSON mode, streaming |
| Schema validation | `zod` | Runtime validation of LLM responses against typed schema |
| System interaction | `node:child_process` | Call `ps`, `lsof`, `sysctl`, `docker` |

### Data Collection Layer

The collector gathers data over a 2-10 second window (configurable via `--window`). It uses macOS system commands wrapped in typed adapters:

| Data | Command | Output |
|------|---------|--------|
| Process list | `ps -eo pid,ppid,pgid,user,stat,tt,%cpu,%mem,rss,vsz,lstart,etime,cputime,command` | Fixed-width columns, parsed into `ProcessInfo[]` with state and controlling terminal |
| Process tree | Derived from `ppid` relationships | `ProcessNode` tree structure |
| Memory pressure | `memory_pressure` + `vm_stat` | `MemoryStats` with free/active/inactive/compressed/wired |
| Swap | `sysctl vm.swapusage` | Total, used, free |
| System load | `sysctl vm.loadavg` | 1/5/15 min load averages (per-core CPU requires Mach API, deferred to v2) |
| Listening ports | `lsof -iTCP -sTCP:LISTEN -n -P` | `PortBinding[]` with PID, port, protocol |
| Docker containers | `docker ps --format json` + `docker inspect --format json <id>` + `docker stats --no-stream --format json` (run twice) | `ContainerInfo[]` with state, restart policy, health, interval CPU, memory |
| Uptime | `sysctl kern.boottime` | Boot timestamp, uptime duration |

**CPU interval measurement:** The collector takes two `ps` samples separated by the sampling window. For each process present in both samples, interval CPU is calculated as:

```text
interval_cpu = (cputime_2 - cputime_1) / (timestamp_2 - timestamp_1) × 100%
```

This uses `cputime` deltas rather than the `%cpu` column, because BSD `ps %cpu` reports a process-lifetime average, not current usage. Processes that appear or disappear between samples are marked as `new` or `exited` rather than assigned an interval value.

**Docker Desktop VM correlation:** The Docker collector tries three detection strategies in order: (1) process name match for `Virtualization.VirtualMachine`, (2) `docker system info` VM resource fields, (3) `com.docker.virtualization` process lookup. It records the VM host process RSS, CPU usage, and resource reservations. If no strategy succeeds, VM correlation is marked `unknown` and the LLM is instructed not to infer the relationship. This enables the key diagnostic pattern: "VM reserves 8GB but containers only use 1.2GB."

Each collector adapter:

- Has a **timeout** calculated as `window_seconds + 5s overhead` (e.g., 3s window → 8s timeout). Total collection budget is 15s.
- Reports **collector status** with error details
- Produces a **typed, versioned** output object
- Is **testable in isolation** via fixture files (pre-captured command output)

**Collector status values:** `complete`, `partial`, `failed`, `skipped`, `denied`. The `denied` status is used when macOS permissions block access (e.g., `lsof` without Full Disk Access). The report explains what was unavailable and why for any non-`complete` status.

If Docker is not running, the Docker collector reports `skipped` and the report notes "Docker not detected." If a permission error blocks `lsof`, the port collector reports `denied` and the report explains what was unavailable.

### Snapshot Schema

The normalizer combines collector outputs into a versioned `SystemSnapshot`:

```typescript
interface SystemSnapshot {
  schema_version: "1.0"
  collected_at: string
  collection_window_seconds: number
  machine: MachineInfo
  memory: MemoryStats
  load: LoadStats
  processes: ProcessInfo[]
  ports: PortBinding[]
  docker: DockerState
  collector_status: CollectorStatus[]
}

interface MachineInfo {
  arch: "arm64" | "x86_64"
  cpu_cores: number              // logical cores via sysctl hw.ncpu
  total_memory_gb: number        // via sysctl hw.memsize
  macos_version: string          // via sysctl kern.osproductversion
  boot_time: string              // via sysctl kern.boottime, ISO 8601
  uptime_hours: number
}

interface MemoryStats {
  free_mb: number                // vm_stat free + speculative pages
  active_mb: number
  inactive_mb: number
  compressed_mb: number
  wired_mb: number
  swap_total_mb: number          // sysctl vm.swapusage
  swap_used_mb: number
  page_size_bytes: number        // vm_stat page size (typically 16384)
}

interface LoadStats {
  load_1min: number              // sysctl vm.loadavg
  load_5min: number
  load_15min: number
}

interface ProcessInfo {
  pid: number
  ppid: number
  pgid: number                   // kept for future group features; v1 kills single PID only
  user: string
  state: string                  // ps stat column (e.g., "Ss", "R+", "Z")
  controlling_terminal: string   // ps tt column ("??" = no terminal)
  lifetime_cpu_percent: number   // ps %cpu (lifetime average, informational only)
  memory_percent: number         // ps %mem
  rss_mb: number
  vsz_mb: number
  start_time: string             // ps lstart, ISO 8601
  elapsed: string                // ps etime (e.g., "12-03:52:26")
  cpu_time: string               // ps cputime (e.g., "45:12.03")
  interval_cpu_percent: number | null  // Calculated from two samples; null for new/exited
  command: string                // full command line
  entity_id: string              // proc_<uuid>, assigned at snapshot build
}

interface PortBinding {
  pid: number
  port: number
  protocol: "tcp"
  process_name: string
  address: string                // e.g., "127.0.0.1" or "*"
}

interface DockerState {
  daemon_available: boolean      // docker info exit code 0
  daemon_version: string | null
  vm_process: VmProcessInfo | null
  containers: ContainerInfo[]
}

interface VmProcessInfo {
  pid: number
  rss_mb: number
  cpu_percent: number            // interval CPU from two ps samples
  reserved_memory_mb: number | null   // from docker system info
  reserved_cpus: number | null
  detection_method: "process_name" | "docker_info" | "docker_virtualization" | "unknown"
}

interface ContainerInfo {
  id: string                     // full container ID
  name: string
  image: string
  state: "running" | "paused" | "exited" | "restarting"
  health: "healthy" | "unhealthy" | "starting" | "none"
  restart_policy: "no" | "always" | "unless-stopped" | "on-failure"
  interval_cpu_percent: number | null  // from two docker stats samples
  memory_usage_mb: number
  entity_id: string              // container_<uuid>
  labels: Record<string, string>      // includes otter.disposable if present
}

interface CollectorStatus {
  name: string
  status: "complete" | "partial" | "failed" | "skipped" | "denied"
  error: string | null
  duration_ms: number
}
```

The full process list is retained locally for safety checks (child process validation, process group resolution). For the LLM payload, processes are grouped:

- **Detail tier:** Top 25 by interval CPU + top 25 by RSS (deduplicated union, sent with full metadata after redaction)
- **Candidate tier:** Every user-owned process with a listening port, runtime > 4 hours, or no controlling terminal — always sent with full metadata regardless of resource ranking (ensures stale dev-server candidates are never hidden)
- **Summary tier:** Remaining processes grouped by executable name, sent as aggregate entries (e.g., `node: 12 processes, total 2.1GB RSS, avg 3% CPU`)

This satisfies two constraints: safety checks have complete lineage data, while the LLM payload stays bounded. Process arguments are truncated to 200 characters. Paths are hashed, not sent raw.

**Data boundary:** `SystemSnapshot` (raw, in-memory only) is used by the validator and executor for safety checks. `RedactedSnapshot` (derived from `SystemSnapshot` via the redaction layer) is the only form sent to the LLM and the only form persisted to trace. The analyzer never sees `SystemSnapshot`; the validator and executor never see `RedactedSnapshot`.

### Redaction Layer

Before sending to the LLM, the redactor transforms the snapshot:

| Field | Redaction Rule |
|-------|---------------|
| Process command arguments | Regex-strip tokens matching API key patterns (`sk-`, `Bearer`, `--token`, `--key`), hash home directory and project paths |
| Usernames | Replace with `[USER]` |
| Hostnames / IPs | Replace with `[HOST]` / `[IP]` |
| Container names | Keep if generic (`redis`, `mysql`), hash if they contain project names or internal naming |
| Port numbers | Keep (needed for diagnosis, not sensitive alone) |
| File paths | Hash all directories, keep only basename (`~/worktrees/project-x/src/index.ts` → `[HASH]/[HASH]/index.ts`) |

**Redaction specifics:**

- **Hash algorithm:** SHA-256, deterministic within a single run (same input → same hash), salted with run ID. Hashes are 8-character prefixes (e.g., `a3f2b1c4`).
- **Path transformation order:** (1) expand `~` to literal home path, (2) replace home path with `[HOME]`, (3) hash each path segment except the final filename, (4) truncate command to 200 chars AFTER redaction (not before).
- **API key patterns:** `sk-[a-zA-Z0-9]{20,}`, `Bearer\s+[a-zA-Z0-9._-]+`, `--token[= ]\S+`, `--key[= ]\S+`, `--password[= ]\S+`, `ghp_[a-zA-Z0-9]{36}`, `github_pat_[a-zA-Z0-9_]{82}`.
- **Container name allowlist:** `redis`, `mysql`, `postgres`, `mongo`, `nginx`, `node`, `python`, `alpine`, `busybox`, `ubuntu`, `debian`. All others are hashed.
- **IPv6:** Match `[0-9a-f:]+:[0-9a-f:]+` pattern and replace with `[IPv6]`.

**Residual risk:** Regex-based redaction cannot catch all sensitive value formats. Known gaps include: database connection strings with embedded credentials, internal service names that match common words, and base64-encoded tokens. The `--preview-payload` flag exists so users can inspect the outbound payload before trusting the pipeline. The trace records every redaction rule applied.

The redacted payload is written to the run trace. `otter scan` always shows a payload summary and asks for consent before sending to the LLM. `--preview-payload` shows the full redacted payload and exits before the LLM step (same snapshot, just stops earlier).

### LLM Analyzer

The analyzer sends the redacted snapshot with a versioned prompt. The v1 prompt template:

```text
You are Otter, a macOS resource diagnostician. Analyze the system snapshot below.

RULES:
- Distinguish measured facts from hypotheses. Use hedged language ("likely", "may indicate") for unsupported inference.
- Identify waste vs. legitimate work: a compiler using CPU is normal; an idle dev server with a stale port is waste.
- Connect cross-system patterns: Docker VM reservation + idle containers + current swap usage.
- Only recommend actions from the allowlist: stop_container, kill_process.
- Reference entities by their entity_id from the snapshot.

OUTPUT (JSON):
{
  "summary": "<one-paragraph diagnosis in plain language>",
  "findings": [{"id": "...", "severity": "info|warning|critical", "evidence_level": "measured|supported_hypothesis|unsupported_inference", "title": "...", "explanation": "...", "evidence_refs": ["entity_id or metric path"]}],
  "recommendations": [{"id": "...", "action_type": "stop_container|kill_process", "target_ref": {"kind": "process|container", "entity_id": "..."}, "reason": "...", "expected_benefit": "..."}]
}

For explain mode, omit the recommendations array entirely.
```

**Model parameters:** `gpt-4o-mini`, `response_format: { type: "json_object" }`, `temperature: 0.1`, `max_tokens: 2000`. The analyzer uses:

1. Identify resource anomalies (things consuming more than expected for their type)
2. Explain causal chains (Docker VM + idle containers + no reboot → swap growth)
3. Distinguish legitimate work from waste (compiler using CPU = normal; idle dev server with stale port = waste)
4. Return recommendations in a strict JSON schema

**LLM response schema (validated with zod):**

```typescript
interface DiagnosticReport {
  summary: string                           // One-paragraph plain-language diagnosis
  findings: Finding[]                       // Ranked list of resource issues
  recommendations?: Recommendation[]        // Present in scan/clean mode, absent in explain mode
}

interface Finding {
  id: string
  severity: "info" | "warning" | "critical"
  evidence_level: "measured" | "supported_hypothesis" | "unsupported_inference"
  title: string                    // "Docker VM reserving 50% of RAM"
  explanation: string              // Plain language why this matters
  evidence_refs: string[]          // References to snapshot data points
}

interface Recommendation {
  id: string
  action_type: "stop_container" | "kill_process"
  target_ref: EntityRef            // Typed reference to snapshot entity
  reason: string                   // LLM-provided explanation (unverified)
  expected_benefit: string         // LLM-provided estimate (unverified, labeled as such)
}

type EntityRef =
  | { kind: "process"; entity_id: string; pid: number; pgid: number; start_time: string }
  | { kind: "container"; entity_id: string; container_id: string }

Entity IDs (`proc_<uuid>`, `container_<uuid>`) are assigned at snapshot build time and are stable within the run. The `EntityRef` contains both the UUID and immutable identity fields (PID + start time for processes, container ID for containers) so that revalidation can confirm the entity has not changed.
```

The LLM **never generates shell commands**. Recommendations reference snapshot entities by ID. Local code resolves these references to actual PIDs or container IDs.

If the LLM response fails schema validation or references nonexistent entities, the report falls back to a local summary ("LLM analysis failed validation, showing raw metrics") rather than displaying unverified content.

### Action Validator & Executor

After the LLM returns recommendations, local code validates each one:

1. **Schema check**: Recommendation conforms to the typed interface
2. **Target resolution**: `target_ref` maps to a real entity in the snapshot
3. **Safety check**: Target is not a system process, root-owned process, or parent with active children
4. **Revalidation**: Immediately before execution, re-run the FULL safety predicate with fresh data: re-check PID exists with same start time and command line, re-check ownership (still user-owned), re-check no active children have appeared, re-check launchd status unchanged, re-check container still idle with same restart policy. Before SIGKILL fallback, re-verify PID identity has not changed.

The user sees each recommendation individually with its risk level, blast radius, and expected benefit. They approve or reject each one via `@clack/prompts` confirmations. Dangerous actions require typing the target name to confirm.

**Risk-level execution policy:**

| Risk Level | Confirmation Behavior |
|-----------|----------------------|
| `safe` | Per-action y/n prompt, then execute |
| `caution` | Per-action y/n with expanded blast-radius display, then execute |
| `dangerous` | Requires typing the exact target name (e.g., type `tunnel-service-mysql`), then execute |

All three risk levels are executable. The escalating confirmation friction reflects the blast radius, not a hard block.

**Safety classification thresholds:**

| Classification | Definition |
|---------------|-----------|
| Idle container | Interval CPU < 2% (two `docker stats` samples) + no health-check failure + restart policy not `always`/`unless-stopped` + container has label `otter.disposable=true` or is in a compose project labeled `disposable` |
| Stale process | User-owned + listening port present + CPU < 1% + runtime > 8 hours + no controlling terminal (`TT` is `??`) |
| Active child | Any process whose `ppid` matches the target's `pid` and is still alive at validation time |
| Protected process | Owned by root or system users (`_windowserver`, `_mds`, etc.), OR appears in `launchctl list` (user domain) or `launchctl print system` (system domain) as a labeled service with matching PID, OR has active children. Note: PPID=1 alone does not count as launchd-managed — orphaned processes are not protected |

These thresholds are implemented in `validator/safety.ts` as deterministic checks. The LLM can suggest, but only these local rules decide.

**ValidatedRecommendation contract:**

```typescript
interface ValidatedRecommendation {
  recommendation: Recommendation      // Original LLM output
  resolved_target: ResolvedTarget     // Concrete PID or container ID
  eligibility: EligibilityResult      // Pass/fail per safety check
  local_risk_level: "safe" | "caution" | "dangerous"  // Derived from system facts
  local_blast_radius: string          // Computed from process tree / container state
  measured_benefit: string            // Based on actual RSS/CPU of target
}

interface EligibilityResult {
  is_user_owned: boolean
  has_active_children: boolean
  is_launchd_managed: boolean
  is_idle_container: boolean
  unknown_state: boolean              // If any check couldn't complete, block
}

// Risk mapping: idle container + no children → safe
//              stale process + no children → safe
//              process with exited children → caution
//              anything with unknown state → dangerous (blocked from execution)
```

Execution uses fixed code paths, not LLM-generated commands:

| Action | Implementation |
|--------|--------------|
| `stop_container` | `docker stop <container_id>` |
| `kill_process` | `process.kill(pid, 'SIGTERM')`, wait 3s, then `SIGKILL` if still alive |

**Execution result schema:**

```typescript
interface ExecutionResult {
  action_id: string
  status: "succeeded" | "failed" | "partially_succeeded" | "target_changed"
  error_code: string | null    // "SIGTERM_TIMEOUT", "PERMISSION_DENIED", etc.
  message: string              // Human-readable result
}
```

If one action fails, Otter continues with remaining confirmed actions and reports each result individually. `target_changed` means revalidation detected the target no longer matches (PID reused, container restarted).

After execution, Otter collects a 3-second post-action sample as a short-term observation. This may not reflect swap reclamation or Docker VM memory release, which can take longer. The report labels it "short-term observation".

### CLI Interface

```bash
otter scan                    # Full diagnostic: collect → analyze → report
                              # Includes recommendations and interactive execution
otter scan --json             # Machine-readable JSON report
otter scan --preview-payload  # Show what would be sent to LLM, don't send
otter scan --local-only       # Skip LLM, show raw local metrics only (no diagnosis)
otter scan --window 5         # Sampling window in seconds (default 3)

otter explain                 # Diagnostic report without recommendations or execution
otter clean                   # Same as scan; semantic alias focused on cleanup
otter config set-api-key      # Store OpenAI API key in macOS Keychain

otter trace list              # List recent diagnostic runs
otter trace show <run-id>     # Show full trace for a run
otter trace export <run-id>   # Export trace with strict sanitization (omits process args))
```

**Mode table:**

| Mode | Collects | LLM Call | Output | Prompts | Executes |
|------|----------|----------|--------|---------|----------|
| `scan` (default, TTY) | Yes | Yes | Terminal report | Payload consent + per-action | Yes |
| `scan --json` | Yes | No* | JSON | Never | Never |
| `scan --preview-payload` | Yes | No | Redacted payload | No | No |
| `scan --local-only` | Yes | No | Raw metrics table | No | No |
| `scan --yes` | Yes | Yes | Terminal report | Skips payload consent | Yes |
| `scan --no-exec` | Yes | Yes | Terminal report | Payload consent only | No |
| Non-TTY (no flags) | Yes | No* | JSON | Never | Never |

**Exit codes:** `0` = success, `1` = partial failure (some collectors failed), `2` = fatal error, `3` = user cancelled, `4` = no API key configured.

**Non-interactive LLM policy:** `*` Non-interactive modes (`--json`, non-TTY, `--yes` without prior consent) default to **no LLM transmission**. They produce a local-only report. To send data to the LLM from a non-interactive context, the user must explicitly pass `--send-llm`, which acknowledges payload transmission. This preserves the invariant that process data never leaves the machine without explicit consent.

**Command semantics:**

- `scan`: Full pipeline including recommendations and interactive execution prompts.
- `explain`: Diagnosis only. Uses a prompt variant that requests findings without recommendations. The `recommendations` field is omitted from the response schema.
- `clean`: Functionally identical to `scan`. Exists as a user-facing semantic alias for "clean up my machine." Not intended for scripting (use `scan --json --no-exec` for non-interactive mode).

### Run Trace Storage

Traces are stored in `~/.otter/traces/` as JSONL files, one per run. Traces store **redacted data only** — the pre-redaction snapshot exists in memory during the run but is never persisted to disk. The trace directory has `0700` permissions:

```text
~/.otter/
  traces/
    20261030T142201-a3f2b1_scan.jsonl  # timestamp + random suffix to prevent collisions
    2026-10-30T15-01-33_scan.jsonl
  settings.json                         # Preferences (no secrets stored here)
```

Each trace contains: redacted snapshot, LLM request/response metadata (redacted), validated recommendations, user confirmations (sanitized), execution results, post-action verification. Traces are local-only, never automatically uploaded. Auto-rotation keeps the last 100 runs.

**Trace event schema:**

```typescript
interface TraceEvent {
  run_id: string
  seq: number                   // Monotonically increasing within the run
  timestamp: string             // ISO 8601
  event_type: "collection_started" | "collection_completed" | "redaction_applied"
    | "llm_request_sent" | "llm_response_received" | "recommendations_validated"
    | "user_confirmed" | "action_executed" | "action_verified" | "run_completed"
    | "run_failed"
  payload: unknown              // Typed per event_type, always redacted
}
```

User confirmation inputs (typed target names) are passed through the same redaction rules before persistence. If trace writing fails, Otter logs a warning to stderr and continues execution.

`otter trace export` outputs a strictly sanitized trace. Process command arguments are omitted entirely from export output, even though they exist in the local redacted trace. There is no flag to export pre-redaction data because it is never stored.

### LLM Configuration

**Provider:** OpenAI only in v1. The model is configurable in `settings.json` (default: `gpt-4o-mini`).

**API key storage:** macOS Keychain via `security add-generic-password -U -s otter -a api-key` (the `-U` flag updates existing entries). Otter reads it at runtime with `security find-generic-password -s otter -a api-key -w`. The API key is passed to OpenAI via the SDK's constructor (in-memory), never via command-line argv. `otter config set-api-key` prompts via stdin, not argv. The key is never written to disk in plaintext, never included in traces, and never sent anywhere except OpenAI's API.

**First-run behavior:** If no API key is found, Otter prints setup instructions and exits with code `1`. The user runs `otter config set-api-key` to store the key.

**No-key fallback:** `otter scan --local-only` works without an API key and outputs the raw metrics table.

**Local-only mode definition:** `--local-only` outputs a formatted metrics table (top processes, memory, swap, Docker status, listening ports). It does not produce causal explanations, findings, or recommendations. It is a fast, private snapshot for users who want raw data or who haven't configured an LLM.

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
        explain.ts
        clean.ts
        config.ts
        trace.ts
    config/
      settings.ts
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
      ps-sample-1.txt
      ps-sample-2.txt
      lsof-output.txt
      lsof-denied.txt
      vm-stat-output.txt
      memory-pressure-output.txt
      sysctl-machine.txt
      sysctl-boottime.txt
      sysctl-swapusage.txt
      sysctl-loadavg.txt
      docker-ps.json
      docker-stats-1.json
      docker-stats-2.json
      docker-inspect.json
      docker-info-down.json
      launchctl-list.txt
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
      resolver.test.ts
      revalidate.test.ts
    snapshot/
      builder.test.ts
    executor/
      actions.test.ts
      verify.test.ts
    trace/
      store.test.ts
    cli/
      modes.test.ts
```

### File-by-File Plan

#### Project Setup

| File | What Changes | Why |
|------|-------------|-----|
| `package.json` | Create. Project `otter` v0.1.0. Dependencies: `commander@^12`, `@clack/prompts@^0.7`, `picocolors@^1`, `cli-table3@^0.6`, `zod@^3`, `openai@^4`, `@types/bun@^1` (dev). Scripts: `dev: bun run src/index.ts`, `build: bun build src/index.ts --compile --outfile dist/otter`, `test: bun test`. Lockfile: `bun.lockb` committed. | Project manifest with pinned versions and reproducible builds. |
| `tsconfig.json` | Create. Target ES2022, module ESNext, moduleResolution: `bundler`, strict mode, types: `["bun-types"]`, no outDir (Bun handles compilation). | TypeScript config for Bun's bundler resolution and runtime types. |
| `bunfig.toml` | Create. Minimal: test preload if path aliases needed. Standalone binary is built via `bun build --compile` in package.json script, not bunfig. | Bun runtime configuration. |
| `.gitignore` | Create. Ignore `node_modules/`, `dist/`, `*.local`, `.env`, `coverage/`. | Prevent committing build artifacts and secrets. |
| `README.md` | Create. Project overview, install instructions, usage examples, development setup. | Entry point for GitHub visitors and new contributors. |

#### CLI Entry

| File | What Changes | Why |
|------|-------------|-----|
| `src/index.ts` | Create. Set up Commander program with `scan`, `explain`, `clean`, `config`, and `trace` subcommands. Parse global options (`--json`, `--local-only`, `--preview-payload`, `--yes`, `--no-exec`, `--send-llm`, `--window`). Dispatch to command handlers. Exit codes: 0 = success, 1 = partial failure, 2 = fatal, 3 = cancelled, 4 = no API key. | Single entry point; routes CLI invocations to command logic. |
| `src/cli/commands/scan.ts` | Create. Orchestrate full pipeline: collect → normalize → redact → analyze (or skip with `--local-only`) → validate → report → optionally confirm and execute. Manage timing budget across stages. Handle SIGINT gracefully (save partial trace). | Core diagnostic workflow; the primary command most users interact with. |
| `src/cli/commands/explain.ts` | Create. Same as scan but skips recommendation generation and execution prompts. Outputs findings only. | Supports diagnosis without cleanup suggestions. |
| `src/cli/commands/clean.ts` | Create. Semantic alias for scan. Delegates to same pipeline. | Matches user mental model of cleanup. |
| `src/cli/commands/config.ts` | Create. Subcommand `set-api-key` stores in macOS Keychain. Subcommand `show` displays settings (redacted). | Secure first-run setup. |
| `src/cli/commands/trace.ts` | Create. Subcommands: `list` (show recent runs), `show <id>` (display full trace), `export <id>` (output strictly sanitized JSON). Read from trace store. | Debugging and audit trail access. |
| `src/config/settings.ts` | Create. Read/write `~/.otter/settings.json` with 0600 permissions. Schema: `{ model: string, enable_execution: boolean }`. Defaults: `gpt-4o-mini`, `false`. | Persistent user configuration without secrets. |

#### Collectors

| File | What Changes | Why |
|------|-------------|-----|
| `src/collectors/types.ts` | Create. Define `Collector<T>` interface: `name`, `timeout_ms`, `collect(): Promise<CollectorResult<T>>` where `CollectorResult` has `status: complete/partial/failed/skipped/denied`, `data: T \| null`, `error: string \| null`, `duration_ms: number`. Define all data type interfaces: `ProcessInfo`, `MemoryStats`, `PortBinding`, `ContainerInfo`, `MachineInfo`, `LoadStats`. | Shared contract for all collectors; enables testing with fixtures. |
| `src/collectors/system.ts` | Create. Collect machine info (arch, CPU cores, total RAM, macOS version) via `sysctl`. Collect uptime via `sysctl kern.boottime`. Collect load averages via `sysctl vm.loadavg`. | Baseline machine context needed for diagnosis. |
| `src/collectors/process.ts` | Create. Run `ps -eo pid,ppid,pgid,user,%cpu,%mem,rss,vsz,lstart,etime,cputime,command` twice. Compute interval CPU from cputime deltas. Build full process tree. Return complete list for safety checks. | Primary diagnostic data; accurate interval CPU and full lineage. |
| `src/collectors/memory.ts` | Create. Run `memory_pressure` for percentage, `vm_stat` for page-level detail, `sysctl vm.swapusage` for swap state. Parse into `MemoryStats` with free, active, inactive, compressed, wired, swap total/used. | Memory pressure is the most common Mac slowdown cause. |
| `src/collectors/ports.ts` | Create. Run `lsof -iTCP -sTCP:LISTEN -n -P`. Parse into `PortBinding[]` with PID, port, protocol, process name. Classify errors: exit code 1 with "Operation not permitted" → `denied`; partial output with some rows → `partial` with available data; connection timeout → `failed`. | Identifies stale dev servers and service conflicts. |
| `src/collectors/docker.ts` | Create. Check if Docker daemon is reachable via `docker info` exit code (0 = reachable, 1 = daemon down, regardless of JSON output). If reachable, run `docker ps --format json` and `docker stats --no-stream --format json` twice (window-separated for interval calculation). Map containers to host processes via Docker Desktop's VM process. If Docker unavailable, report `skipped`. | Docker is the single largest resource consumer in typical developer setups. |
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
| `src/validator/safety.ts` | Create. Given a `Recommendation` and the current `SystemSnapshot`, check: target is user-owned (not root/system), target has no active child processes (for kill actions), container is actually idle (for stop actions), process is not a labeled launchd service (via `launchctl list`). Return pass/fail per check with reasons. | Deterministic local safety checks independent of LLM judgment. |
| `src/validator/resolver.ts` | Create. Given a typed `EntityRef`, resolve to concrete PID or container ID by looking up snapshot entities. Return `ResolvedTarget` with full identity (PID, start time, command line, container ID). | Bridges LLM abstract references to concrete system targets. |
| `src/validator/revalidate.ts` | Create. Immediately before execution, re-run minimal collection: check PID exists, start time matches, command line matches, container ID and state unchanged. Return `RevalidationResult` (ok / target_changed / target_gone). | Prevents TOCTOU attacks and stale-snapshot mistakes. |

#### Executor

| File | What Changes | Why |
|------|-------------|-----|
| `src/executor/actions.ts` | Create. Implement two actions with fixed code paths: `stopContainer(containerId)` → `docker stop`, `killProcess(pid)` → SIGTERM then SIGKILL after 3s. Each action logs start/end/result to trace. No shell interpolation of LLM content. | The only code that touches the system destructively; must be minimal and fixed. |
| `src/executor/verify.ts` | Create. After action, wait 3 seconds, re-collect memory and process state, compare against pre-action snapshot. Report freed memory, stopped processes, remaining pressure. | Verifies the action achieved its stated benefit; catches supervised processes that respawned. |

#### Reporter

| File | What Changes | Why |
|------|-------------|-----|
| `src/reporter/terminal.ts` | Create. Render diagnostic report to terminal: summary paragraph, findings table (severity-colored), recommendations with risk badges and blast radius, confirmation prompts via `@clack/prompts`. | Primary user-facing output; readability is the product. |
| `src/reporter/json.ts` | Create. Serialize report to JSON for `--json` mode. Include all fields from `DiagnosticReport` plus execution results if actions ran. | Machine-readable output for scripting and CI. |

#### Trace

| File | What Changes | Why |
|------|-------------|-----|
| `src/trace/types.ts` | Create. Define `TraceEvent` union type: `collection_started`, `collection_completed`, `redaction_applied`, `llm_request_sent`, `llm_response_received`, `recommendations_validated`, `user_confirmed`, `action_executed`, `action_verified`, `run_completed`, `run_failed` (all snake_case). Each event has run ID, sequence number, timestamp. | Typed event schema for the audit trail. |
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

### Rollout Gating

Execution is feature-flagged. The default configuration disables execution until diagnosis quality is validated:

1. **Phase 1 (v0.1):** Read-only diagnosis. `scan` and `explain` produce reports. `clean` prints recommendations but does not execute. Feature flag: `enable_execution: false` (default).
2. **Phase 2 (v0.2):** After evaluating report quality against real snapshots, flip default to `enable_execution: true`. Users can still disable via settings.

This staging ensures the highest-risk capability (destructive execution) only ships after the core diagnostic value is proven.

### Implementation Order

Build in this sequence. Each step has an explicit verification command and expected output. Later steps depend on earlier ones being complete.

1. **Project scaffold + config**: `package.json` (with pinned versions + lockfile), `tsconfig.json` (bundler resolution, Bun types), `bunfig.toml`, `.gitignore`, `src/index.ts` with all subcommands (scan/explain/clean/config/trace) as stubs, `src/config/settings.ts` (settings.json read/write with 0600 permissions). Verify: `otter --help` prints usage, exit 0.

2. **Trace store**: `src/trace/types.ts`, `src/trace/store.ts`. Create `~/.otter/traces/` with 0700 permissions. Run IDs are `YYYYMMDDTHHMMSS-<random-6>` to prevent collisions. Event types use snake_case consistently. Verify: `otter trace list` shows empty list, exit 0.

3. **System + memory collectors**: `collectors/types.ts`, `system.ts`, `memory.ts`. Parse `sysctl` output for machine info, `memory_pressure`, `vm_stat`, `vm.swapusage`. Verify: `otter scan --local-only --json` outputs `MachineInfo` and `MemoryStats` as valid JSON, exit 0.

4. **Process collector**: `collectors/process.ts`. Run `ps -eo pid,ppid,pgid,user,stat,tt,%cpu,%mem,rss,vsz,lstart,etime,cputime,command` twice. Parse fixed-width columns. Calculate interval CPU from cputime deltas. Build full process tree. Verify: fixture test parses sample `ps` output correctly, interval CPU calculation verified against known values.

5. **Ports + Docker collectors**: `ports.ts`, `docker.ts`. Parse `lsof` output (handle `denied` vs `partial`). Docker: check daemon via `docker info` exit code, `docker ps --format json`, `docker inspect` for restart policy/health/labels, `docker stats --no-stream` twice for interval. VM detection via three strategies with fallback. Verify: fixture tests pass for all parsers including error cases.

6. **Snapshot schema + builder**: `snapshot/schema.ts` (full Zod schema with all nested types), `builder.ts` (assigns entity IDs, validates). Verify: `otter scan --local-only --json` outputs complete `SystemSnapshot` that validates against schema.

7. **Redactor + payload tiering**: `redactor/rules.ts` (SHA-256 deterministic per-run hashes, regex patterns, exact allowlists), `redact.ts` (applies rules + three-tier payload: detail top-25-by-CPU + top-25-by-RSS deduplicated, candidate tier for user-owned+port-listening+4h-runtime, summary tier for rest). Verify: `otter scan --preview-payload` shows redacted JSON, no raw paths/args visible, exit 0.

8. **Reporter + local-only**: `reporter/terminal.ts`, `json.ts`. Terminal renders metrics table, findings with severity colors, recommendations with risk badges. JSON serializes full report. Local-only mode outputs raw metrics table. Verify: `otter scan --local-only` renders readable table to stderr, exit 0; `otter scan --local-only --json` outputs JSON to stdout, exit 0.

9. **Config + LLM analyzer**: `cli/commands/config.ts` (Keychain with `-U` flag, secret via stdin not argv), `analyzer/prompt.ts` (v1 template above, explain variant), `llm.ts` (OpenAI with structured output), `response.ts` (Zod validation, entity ref checking, fallback to local summary). Verify: `otter config set-api-key` stores in Keychain; `otter explain --send-llm` produces valid JSON report, exit 0 (requires API key).

10. **Validator**: `validator/safety.ts` (full predicate: ownership, children, launchd via `launchctl list` + `launchctl print system`, container idle+disposable), `resolver.ts` (typed EntityRef resolution), `revalidate.ts` (full re-predicate before execution, PID re-verify before SIGKILL). Verify: fixture tests reject root process, process with children, non-disposable container; approve stale disposable process.

11. **Executor + verifier**: `executor/actions.ts` (stop_container via docker stop, kill_process via SIGTERM→3s→verify identity→SIGKILL), `verify.ts` (3s post-action sample labeled "short-term observation"). Feature flag `enable_execution` defaults to `false`. Verify: with flag enabled, `otter clean` against a test `docker run -d --label otter.disposable=true alpine sleep 60` stops it and reports `ExecutionResult.status: "succeeded"`.

12. **Scan/clean/explain full pipeline**: `cli/commands/scan.ts` orchestrates full flow with global deadline enforcement. `explain.ts` and `clean.ts` delegate to shared pipeline with mode flags. Verify: end-to-end test produces trace file, report, and exit 0 in all three modes.
