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
