import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { localCommandRunner } from "../collectors/runner.ts";
import type { CommandRunner } from "../collectors/types.ts";
import { collectSystemSnapshot } from "../collectors/index.ts";
import { buildSystemSnapshot } from "../snapshot/builder.ts";
import { redactSnapshot } from "../redactor/redact.ts";
import { redactedPayloadSchema, type RedactedPayload } from "../redactor/schema.ts";
import { openTraceStore, type TraceStore } from "../trace/store.ts";
import type { TraceEventDraft } from "../trace/schema.ts";
import type {
  ActionVerification,
  ExecutionResult,
  ExecutionSummary,
  ProcessControl,
} from "../executor/types.ts";
import { killProcess, stopContainer } from "../executor/actions.ts";
import { verifyAction } from "../executor/verify.ts";
import { createTerminalConfirmation, type ConfirmationAdapter } from "./confirm.ts";
import {
  collectServicePids,
} from "../validator/revalidate.ts";
import {
  summarizeValidatedCandidate,
  validateCandidates,
  type ValidatedCandidate,
} from "../validator/safety.ts";
import type { FetchLike } from "../analyzer/client.ts";
import {
  createLocalReport,
  renderLocalReport,
} from "../reporter/local.ts";
import { requestAnalyzer } from "../analyzer/client.ts";
import { buildAnalyzerPrompt, promptVersion } from "../analyzer/prompt.ts";
import { validateAnalyzerResponse, type AnalyzerReport } from "../analyzer/response.ts";
import { resolveApiKey } from "../config/keychain.ts";
import { analyzerBaseUrl, readSettings, type Settings } from "../config/settings.ts";

export interface DiagnosticOptions {
  readonly command: "scan" | "explain" | "clean";
  readonly json: boolean;
  readonly localOnly: boolean;
  readonly previewPayload: boolean;
  readonly sendLlm: boolean;
  readonly windowSeconds: number;
  readonly traceRoot: string;
  readonly configRoot: string;
  readonly commandRunner?: CommandRunner;
  readonly now?: () => Date;
  readonly currentUser?: string;
  readonly isInteractive?: () => boolean;
  readonly confirmation?: ConfirmationAdapter;
  readonly processControl?: ProcessControl;
  readonly waitMs?: (milliseconds: number) => Promise<void>;
  readonly revalidationWindowSeconds?: number;
  readonly analyzerFetch?: FetchLike;
}

export interface DiagnosticSuccess {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
  readonly runId: string;
  readonly traceRoot: string;
}

function makeRunId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  return `${stamp}-${randomUUID().slice(0, 6)}`;
}

async function appendTrace(
  trace: TraceStore,
  draft: TraceEventDraft,
): Promise<void> {
  await trace.append(draft);
}

function executionDisposition(
  command: DiagnosticOptions["command"],
  settings: Settings,
  options: DiagnosticOptions,
): ExecutionSummary {
  if (command !== "clean") {
    return {
      enabled: settings.enableExecution,
      status: "not_available",
      reason: "Execution is available only in clean mode.",
      results: [],
    };
  }
  if (options.localOnly) {
    return {
      enabled: settings.enableExecution,
      status: "not_available",
      reason: "Local-only mode is diagnostic and never executes.",
      results: [],
    };
  }
  if (!settings.enableExecution) {
    return {
      enabled: false,
      status: "disabled",
      reason: "Execution is disabled in settings.",
      results: [],
    };
  }
  if (options.json) {
    return {
      enabled: true,
      status: "not_available",
      reason: "JSON output cannot provide the required per-candidate confirmation.",
      results: [],
    };
  }
  const interactive = options.isInteractive?.() ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    return {
      enabled: true,
      status: "not_available",
      reason: "An interactive terminal is required for execution.",
      results: [],
    };
  }
  return {
    enabled: true,
    status: "complete",
    reason: "Per-candidate interactive confirmation is active.",
    results: [],
  };
}

async function executeConfirmedCandidates(
  validated: readonly ValidatedCandidate[],
  options: DiagnosticOptions,
  trace: TraceStore,
): Promise<{
  readonly results: readonly ExecutionResult[];
  readonly verifications: readonly ActionVerification[];
}> {
  const confirmation = options.confirmation ??
    createTerminalConfirmation(process.stdin, process.stdout);
  const results: ExecutionResult[] = [];
  const verifications: ActionVerification[] = [];
  for (const candidate of validated) {
    if (candidate.eligibility.status !== "eligible") continue;
    const summary = summarizeValidatedCandidate(candidate);
    const approved = await confirmation.confirm(summary);
    await appendTrace(trace, {
      eventType: "user_confirmed",
      payload: { candidateId: summary.candidateId, approved },
    });
    if (!approved) continue;
    const executorOptions = {
      runner: options.commandRunner ?? localCommandRunner,
      currentUser: options.currentUser ?? userInfo().username,
      ...(options.processControl === undefined ? {} : { processControl: options.processControl }),
      ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
      ...(options.revalidationWindowSeconds === undefined
        ? {}
        : { revalidationWindowSeconds: options.revalidationWindowSeconds }),
    };
    let result: ExecutionResult;
    try {
      result = candidate.candidate.kind === "process"
        ? await killProcess(candidate.candidate, executorOptions)
        : await stopContainer(candidate.candidate, executorOptions);
    } catch {
      result = {
        candidateId: summary.candidateId,
        actionType: summary.actionType,
        status: "failed",
        errorCode: "ACTION_FAILED",
        message: "The action failed before completion.",
      };
    }
    results.push(result);
    await appendTrace(trace, { eventType: "action_executed", payload: result });
    if (result.status === "succeeded" || result.status === "partially_succeeded") {
      const verification = await verifyAction(candidate.candidate, {
        runner: executorOptions.runner,
        currentUser: executorOptions.currentUser,
        ...(executorOptions.revalidationWindowSeconds === undefined
          ? {}
          : { revalidationWindowSeconds: executorOptions.revalidationWindowSeconds }),
      });
      verifications.push(verification);
      await appendTrace(trace, { eventType: "action_verified", payload: verification });
    }
  }
  return { results, verifications };
}

function parsePayload(payload: RedactedPayload): RedactedPayload {
  return redactedPayloadSchema.parse(payload);
}

export async function runDiagnostic(options: DiagnosticOptions): Promise<DiagnosticSuccess> {
  if (options.localOnly && options.sendLlm) {
    throw new Error("--local-only and --send-llm cannot be combined");
  }
  if (options.previewPayload && options.sendLlm) {
    throw new Error("--preview-payload stops before LLM transmission");
  }

  const now = options.now ?? (() => new Date());
  const runId = makeRunId(now());
  const runner = options.commandRunner ?? localCommandRunner;
  const trace = await openTraceStore(
    options.traceRoot,
    runId,
    options.command,
    options.windowSeconds,
  );

  try {
    const collection = await collectSystemSnapshot(runner, options.windowSeconds);
    const snapshot = buildSystemSnapshot(collection, options.windowSeconds);
    await appendTrace(trace, {
      eventType: "collection_completed",
      payload: { statuses: snapshot.collectorStatus },
    });
    const currentUser = options.currentUser ?? userInfo().username;
    const redaction = redactSnapshot(snapshot, { runId, currentUser });
    const payload = parsePayload(redaction.payload);
    await appendTrace(trace, {
      eventType: "redaction_applied",
      payload: {
        redactedPayload: payload,
        processArgumentsOmitted: true,
      },
    });

    if (options.previewPayload) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(payload, null, 2)}\n`,
        stderr: "",
        runId,
        traceRoot: options.traceRoot,
      };
    }

    const portsByPid = new Map<number, number[]>();
    for (const port of snapshot.ports) {
      const ports = portsByPid.get(port.pid) ?? [];
      ports.push(port.port);
      portsByPid.set(port.pid, ports);
    }
    const serviceManagerPids = await collectServicePids(runner);
    const validated = validateCandidates(
      redaction.candidateBook.records,
      snapshot.processes,
      snapshot.docker.containers,
      portsByPid,
      currentUser,
      serviceManagerPids,
    );
    const validatedSummaries = validated.map(summarizeValidatedCandidate);
    await appendTrace(trace, {
      eventType: "recommendations_validated",
      payload: { candidates: [...validatedSummaries] },
    });

    const settings = await readSettings(options.configRoot);
    const executionPlan = executionDisposition(options.command, settings, options);
    let execution: ExecutionSummary = executionPlan;

    if (!options.sendLlm) {
      if (execution.status === "complete") {
        const attempted = await executeConfirmedCandidates(validated, options, trace);
        execution = {
          ...execution,
          results: [...attempted.results],
          verifications: [...attempted.verifications],
        };
      }
      const report = createLocalReport(payload, "local", {
        validatedCandidates: validatedSummaries,
        execution,
      });
      await appendTrace(trace, {
        eventType: "run_completed",
        payload: { report },
      });
      return {
        exitCode: snapshot.collectorStatus.some(
          (status) => status.status === "failed" || status.status === "denied",
        ) || execution.results.some(
          (result) => result.status !== "succeeded" && result.status !== "skipped",
        ) ? 1 : 0,
        stdout: options.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderLocalReport(report)}\n`,
        stderr: "",
        runId,
        traceRoot: options.traceRoot,
      };
    }

    let analyzer: AnalyzerReport | null = null;
    let analyzerError: string | null = null;
    const apiKey = await resolveApiKey(runner, settings.model);
    if (apiKey === null) throw new Error("NO_API_KEY");
    const prompt = buildAnalyzerPrompt(payload, options.command === "explain" ? "explain" : "scan");
    await appendTrace(trace, {
      eventType: "llm_request_sent",
      payload: { promptVersion, model: settings.model },
    });
    let wire: unknown;
    try {
      wire = await requestAnalyzer(prompt, {
        baseUrl: analyzerBaseUrl(settings.model),
        apiKey,
        model: settings.model,
        ...(options.analyzerFetch === undefined ? {} : { fetchImpl: options.analyzerFetch }),
      });
    } catch (error) {
      analyzerError = error instanceof Error ? error.message : "analyzer request failed";
      await appendTrace(trace, {
        eventType: "llm_response_received",
        payload: { valid: false, report: null, errors: [analyzerError] },
      });
    }
    if (analyzerError === null) {
      const validation = validateAnalyzerResponse(wire, payload);
      await appendTrace(trace, {
        eventType: "llm_response_received",
        payload: {
          valid: validation.status === "valid",
          report: validation.status === "valid" ? validation.report : null,
          errors: validation.status === "valid" ? [] : [...validation.errors],
        },
      });
      if (validation.status === "valid") analyzer = validation.report;
      else {
        analyzerError = `LLM response failed validation: ${validation.errors.join("; ")}`;
      }
    }
    if (execution.status === "complete") {
      const attempted = await executeConfirmedCandidates(validated, options, trace);
      execution = {
        ...execution,
        results: [...attempted.results],
        verifications: [...attempted.verifications],
      };
    }
    const report = createLocalReport(payload, "analyzed", {
      validatedCandidates: validatedSummaries,
      analyzer,
      analyzerError,
      execution,
    });
    await appendTrace(trace, {
      eventType: "run_completed",
      payload: { report },
    });
    return {
      exitCode: analyzerError === null && !snapshot.collectorStatus.some(
        (status) => status.status === "failed" || status.status === "denied",
      ) && execution.results.every(
        (result) => result.status === "succeeded" || result.status === "skipped",
      ) ? 0 : 1,
      stdout: options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderLocalReport(report)}\n`,
      stderr: "",
      runId,
      traceRoot: options.traceRoot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "diagnostic failed";
    try {
      await appendTrace(trace, { eventType: "run_failed", payload: { message } });
    } catch {
      // Preserve the original failure even when audit writing also fails.
    }
    throw error;
  }
}
