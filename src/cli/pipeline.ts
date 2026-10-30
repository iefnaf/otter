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
import {
  createLocalReport,
  renderLocalReport,
  sanitizeTerminalText,
} from "../reporter/local.ts";
import { requestAnalyzer } from "../analyzer/client.ts";
import { buildAnalyzerPrompt, promptVersion } from "../analyzer/prompt.ts";
import { validateAnalyzerResponse, type AnalyzerReport } from "../analyzer/response.ts";
import { getApiKey } from "../config/keychain.ts";
import { readSettings, type Settings } from "../config/settings.ts";

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

function renderAnalyzerReport(report: AnalyzerReport): string {
  const lines = [report.summary, "", "Findings"];
  for (const finding of report.findings) {
    lines.push(`${finding.severity}: ${finding.title}`);
    lines.push(finding.explanation);
    lines.push(`evidence ${finding.evidenceLevel}`);
  }
  if (report.candidateOpinions.length > 0) {
    lines.push("", "Unverified, non-executable candidate opinions");
    for (const opinion of report.candidateOpinions) {
      lines.push(`${opinion.candidateId}: ${opinion.assessment}, confidence ${opinion.confidence}`);
      lines.push(opinion.explanation);
    }
  }
  lines.push("", "Opinions are not recommendations and Otter cannot execute them.");
  return lines.map(sanitizeTerminalText).join("\n");
}

async function appendTrace(
  trace: TraceStore,
  draft: TraceEventDraft,
): Promise<void> {
  await trace.append(draft);
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
    const redaction = redactSnapshot(snapshot, {
      runId,
      currentUser: userInfo().username,
    });
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

    if (!options.sendLlm) {
      const report = createLocalReport(payload, "local");
      await appendTrace(trace, {
        eventType: "run_completed",
        payload: { report },
      });
      return {
        exitCode: snapshot.collectorStatus.some(
          (status) => status.status === "failed" || status.status === "denied",
        ) ? 1 : 0,
        stdout: options.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderLocalReport(report)}\n`,
        stderr: options.command === "clean" ? "Execution is disabled in Otter v0.1.\n" : "",
        runId,
        traceRoot: options.traceRoot,
      };
    }

    const settings: Settings = await readSettings(options.configRoot);
    const apiKey = await getApiKey(runner);
    if (apiKey === null) throw new Error("NO_API_KEY");
    const prompt = buildAnalyzerPrompt(payload, options.command === "explain" ? "explain" : "scan");
    await appendTrace(trace, {
      eventType: "llm_request_sent",
      payload: { promptVersion, model: settings.model },
    });
    const wire = await requestAnalyzer(prompt, {
      baseUrl: settings.apiBase,
      apiKey,
      model: settings.model,
    });
    const validation = validateAnalyzerResponse(wire, payload);
    await appendTrace(trace, {
      eventType: "llm_response_received",
      payload: {
        valid: validation.status === "valid",
        report: validation.status === "valid" ? validation.report : null,
        errors: validation.status === "valid" ? [] : [...validation.errors],
      },
    });
    if (validation.status === "invalid") {
      throw new Error(`LLM response failed validation: ${validation.errors.join("; ")}`);
    }
    await appendTrace(trace, {
      eventType: "run_completed",
      payload: { report: validation.report },
    });
    return {
      exitCode: 0,
      stdout: options.json
        ? `${JSON.stringify(validation.report, null, 2)}\n`
        : `${renderAnalyzerReport(validation.report)}\n`,
      stderr: "",
      runId,
      traceRoot: options.traceRoot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "diagnostic failed";
    await appendTrace(trace, { eventType: "run_failed", payload: { message } });
    throw error;
  }
}
