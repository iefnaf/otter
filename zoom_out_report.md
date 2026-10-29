# Stage 5: Initial Zoom Out Review

* **Target:** `design_draft.md`
* **Reviewer:** egm-zoom-out
* **Date:** 2026-10-30
* **Mode:** Interactive full flow

## Verdict

The underlying problem is real and narrowly framed, but the document is not ready for implementation. The current design sells causal certainty and safe execution while its data model, privacy boundary, validation model, and rollout plan cannot yet guarantee either.

## Findings

### BLOCKER — The snapshot cannot support the causal claims at the core of the product

**Scope:** Problem and Overview (`design_draft.md:13`, `:21`, `:32`), collection plan (`:92`), non-goal (`:47`), process collector (`:383`).

The product's central promise is causal explanation: Docker memory plus idle containers plus uptime caused swap growth and slowness. The proposed snapshot does not collect the evidence needed to make that claim:

- `sysctl vm.swapusage` provides current swap use, not swap growth or its cause.
- A 2-10 second window cannot establish multi-day accumulation or "stale" behavior.
- Listening sockets do not prove port inactivity; the design claims "port activity" but collects only listeners.
- Two `ps` samples do not correctly measure CPU over the interval because BSD `ps %cpu` is based on accumulated process CPU time over elapsed lifetime, not current interval usage.
- The document explicitly rejects historical baselines while still promising diagnosis based on "swap growth."

The LLM will infer causality from correlated point-in-time values. That is exactly the failure mode the product claims to solve. The design must either narrow the language to evidence-backed hypotheses and confidence limits, or define a minimal set of observations that can actually support each class of claim.

### BLOCKER — The execution safety model is incomplete and can target the wrong processes

**Scope:** Action Validator & Executor (`design_draft.md:192`, `:177`), process collection (`:96`, `:383`), validator files (`:415`), executor (`:423`).

The safety promise is stronger than the data model:

- `ProcessInfo` is not defined with a stable entity ID, process group ID, start time, parent identity, or complete descendant graph.
- Revalidation requires start time, but the proposed `ps` command does not collect it.
- `process.kill(-pid, ...)` assumes `pid` is a process-group leader. A non-leader PID with a negative signal targets the group led by that numeric PID and may miss the intended group or hit unrelated processes.
- Returning only the top 100 processes makes "no active children" unverifiable. A low-resource but active child can be omitted from the snapshot.
- `quit_app` has no app entity in `SystemSnapshot`, no unsaved-work model, and no deterministic blast-radius calculation.
- `blast_radius` and `expected_benefit` are LLM-generated strings, not locally derived facts.

Before implementation, the snapshot and validator need complete process identity and lineage metadata, stable target references, deterministic blast-radius computation, and an execution mechanism that targets the collected process group rather than assuming PID equality.

### BLOCKER — Privacy-by-default conflicts with the redaction and trace design

**Scope:** Privacy goal (`design_draft.md:34`), snapshot and redaction (`:133`, `:137`), trace storage (`:230`), redactor implementation (`:400`), trace export (`:227`), config (`:239`).

The privacy boundary is not actually a boundary:

- Process arguments are collected and then filtered with a regex denylist. Unknown credentials, authorization headers, internal URLs, database URLs, and project-identifying arguments can still leave the machine.
- The path rule says paths are hashed, but the example preserves `project-x/src/index.ts`; that contradicts the stated rule and still exposes project structure.
- Traces contain a "pre-redaction reference," creating a local store of sensitive process arguments and paths.
- `trace export` is described as shareable even though the trace may contain pre-redaction data.
- No file permissions, encryption, or safe-export behavior is specified.
- `config.toml` stores the API key in plaintext despite targeting macOS, where Keychain or environment-based secret loading is the platform-appropriate mechanism.

The safer root fix is to avoid transmitting raw arguments at all: classify command lines locally and send only executable name, normalized process class, safe tags, and resource metrics. Raw data, if retained for debugging, needs explicit local-only protections and export must emit the redacted form by default.

### MAJOR — Schema validation does not validate the truth or usefulness of the diagnosis

**Scope:** LLM Analyzer (`design_draft.md:150`, `:159`, `:190`), response validator (`:407`).

Zod validation plus reference existence only proves shape. It does not prove that:

- `explanation` follows from `evidence_refs`.
- `severity` matches measured impact.
- `confidence` corresponds to evidence completeness.
- `expected_benefit` is physically plausible.
- Causal language is supported by the collected signals.

A hallucinated but structurally valid explanation can still destroy trust. The design needs a deterministic evidence contract: findings should reference machine-checkable predicates and measured values, while local code either generates or verifies the claim. It also needs an evaluation set of real snapshots with expected diagnoses before diagnosis quality is considered validated.

### MAJOR — The rollout contradicts the predecessor's safety staging and removes the success gate

**Scope:** Read-only alternative (`design_draft.md:262`), implementation order (`:458`), predecessor staging (`concepts_brief.md:70`), success metric (`concepts_brief.md:75`).

The predecessor explicitly staged read-only diagnosis first, execution second, and defined success as whether the report changes a user's decision. The draft dismisses read-only as "a prettier Activity Monitor," includes execution in the same MVP, and supplies no quality threshold for enabling execution.

That is a strategic inversion: it builds the highest-risk capability before proving the core diagnostic value. The implementation order partially preserves staging, but the document does not say whether execution is feature-flagged off until diagnosis quality is proven. It should restore an explicit gate: read-only pilot, measured diagnostic accuracy and user value, then enable execution.

### MAJOR — "Idle container" is undefined and is not sufficient evidence that stopping is safe

**Scope:** Overview (`design_draft.md:23`), Docker collector (`:102`), validation rules (`:260`, `:415`), Docker implementation (`:386`).

Low CPU and memory do not make a container disposable. A database, queue, cache, sidecar, or local dependency may be idle at the sample moment but still be required. `docker stats --no-stream` does not establish idleness over a meaningful interval, and the design does not inspect restart policy, compose project, health status, image semantics, volume mounts, or user intent.

"Idle" needs a precise definition and a narrow eligibility policy. For v1, the safest option is to restrict execution to containers explicitly identifiable as disposable development resources, rather than any statistically quiet container.

### MAJOR — Local-only mode is promised but not designed

**Scope:** Privacy goal (`design_draft.md:34`), local fallback (`:190`), CLI mode (`:219`), rule-based alternative (`:254`).

`--local-only` says it will show "raw local analysis," but there is no local analyzer in the architecture or file plan. The rule-based engine is rejected as a primary approach, and no deterministic local-report module replaces it.

This leaves three inconsistent interpretations: local-only means raw metrics, a deterministic diagnosis subset, or a feature that cannot be implemented as described. The document must choose one. If privacy-by-default depends on local-only mode, this is part of the launch contract, not an unspecified rendering detail.

### MAJOR — Timing budgets contradict the 60-second product goal

**Scope:** Speed goal (`design_draft.md:35`), collector timeout (`:107`), CLI window (`:220`), LLM client (`:408`).

The budget model is internally inconsistent:

- The process collector waits `window` seconds between two `ps` samples, but each collector has a default 3-second timeout. Even the default 3-second window may exceed its own timeout after overhead; a 10-second window definitely will.
- The LLM client allows a 30-second timeout plus one retry, allowing approximately 60 seconds for analysis before adding up to 10 seconds of collection and reporting overhead.
- Therefore the stated under-60-second invocation-to-report target is not enforceable.

The design needs one global deadline with stage-specific derived deadlines, not independent optimistic timeouts.

### MAJOR — The MVP is over-modularized and drops into premature implementation detail

**Scope:** Architecture (`design_draft.md:51`), technology stack (`:73`), GUI rationale (`:270`), detailed file plan (`:286`).

A first CLI is planned as roughly thirty files, independently versioned stages, provider abstraction, future GUI wrapping, and full fixture/test scaffolding before diagnosis value has been demonstrated. The document also spends nearly 200 lines specifying files and helper responsibilities before resolving the product's causal-evidence and execution-safety questions.

A smaller vertical slice — collect, normalize, redact, analyze, report, trace — would prove the core hypothesis faster. Independent stage versioning and GUI-oriented separation are speculative. Code search found no existing `otter/` implementation or shared package to reuse; the project is greenfield, which makes a minimal first cut more important rather than less.

### NIT — The CLI contract and file plan drift

**Scope:** CLI Interface (`design_draft.md:215`), project structure (`:299`), command files (`:373`).

`otter clean` and `otter explain` are advertised, but neither has a command file or implementation-plan entry. Also, `scan` already appears to include recommendations and confirmation, so the semantic difference between `scan` and `clean` is unclear. The CLI surface should be reduced or the plan should match the documented commands.
