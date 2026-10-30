import { z } from "zod";
import { collectorStatusSchema } from "../snapshot/schema.ts";
import type { RedactedPayload } from "../redactor/schema.ts";
import { analyzerResponseSchema } from "../analyzer/response.ts";
import { executionSummarySchema, type ExecutionSummary } from "../executor/types.ts";
import type { ValidatedCandidateSummary } from "../validator/safety.ts";
import { validatedCandidateSummarySchema } from "../validator/schema.ts";

export const localReportSchema = z.object({
  schemaVersion: z.literal("1.0-local"),
  runId: z.string().min(1),
  mode: z.enum(["local", "preview", "analyzed"]),
  summary: z.object({
    architecture: z.string(),
    macosVersion: z.string(),
    cpuCores: z.number(),
    totalMemoryGb: z.number(),
    uptimeHours: z.number(),
    freeMemoryMb: z.number(),
    swapUsedMb: z.number(),
    load1Min: z.number(),
  }),
  topProcesses: z.array(z.object({
    executable: z.string(),
    intervalCpuPercent: z.number().nullable(),
    rssMb: z.number(),
  })),
  listeningPorts: z.number().int().nonnegative(),
  docker: z.object({
    available: z.boolean(),
    containerCount: z.number().int().nonnegative(),
    disposableCandidates: z.number().int().nonnegative(),
  }),
  candidateCount: z.number().int().nonnegative(),
  validatedCandidates: z.array(validatedCandidateSummarySchema),
  analyzer: analyzerResponseSchema.nullable().optional(),
  analyzerError: z.string().nullable().optional(),
  collectorStatus: z.array(collectorStatusSchema),
  execution: executionSummarySchema,
});

export type LocalReport = z.infer<typeof localReportSchema>;

export function createLocalReport(
  payload: RedactedPayload,
  mode: "local" | "preview" | "analyzed",
  details: {
    readonly validatedCandidates?: readonly ValidatedCandidateSummary[];
    readonly analyzer?: LocalReport["analyzer"];
    readonly analyzerError?: string | null;
    readonly execution?: ExecutionSummary;
  } = {},
): LocalReport {
  return {
    schemaVersion: "1.0-local",
    runId: payload.runId,
    mode,
    summary: {
      architecture: payload.machine.arch,
      macosVersion: payload.machine.macosVersion,
      cpuCores: payload.machine.cpuCores,
      totalMemoryGb: payload.machine.totalMemoryGb,
      uptimeHours: payload.machine.uptimeHours,
      freeMemoryMb: payload.memory.freeMb,
      swapUsedMb: payload.memory.swapUsedMb,
      load1Min: payload.load.oneMinute,
    },
    topProcesses: payload.processTiers.detail.slice(0, 10).map((process) => ({
      executable: process.executable,
      intervalCpuPercent: process.intervalCpuPercent,
      rssMb: process.rssMb,
    })),
    listeningPorts: payload.ports.length,
    docker: {
      available: payload.docker.daemonAvailable,
      containerCount: payload.docker.containers.length,
      disposableCandidates: payload.candidateBook.filter(
        (candidate) => candidate.kind === "container",
      ).length,
    },
    candidateCount: payload.candidateBook.length,
    validatedCandidates: [...details.validatedCandidates ?? []],
    analyzer: details.analyzer ?? null,
    analyzerError: details.analyzerError ?? null,
    collectorStatus: payload.collectorStatus,
    execution: details.execution ?? {
      enabled: false,
      status: "disabled",
      reason: "Execution is disabled in settings.",
      results: [],
    },
  };
}

function isDecisionReady(
  candidate: LocalReport["validatedCandidates"][number],
): candidate is ValidatedCandidateSummary {
  return "decision" in candidate;
}

function candidateLine(candidate: ValidatedCandidateSummary): string {
  if (candidate.target.kind === "process") {
    const cpu = candidate.target.intervalCpuPercent === null
      ? "unknown CPU"
      : `${candidate.target.intervalCpuPercent.toFixed(1)}% CPU`;
    const ports = candidate.target.listeningPorts.length === 0
      ? "no listening port"
      : `port ${candidate.target.listeningPorts.join(", ")}`;
    return `  ${candidate.target.executable} · PID ${candidate.target.pid} · ${candidate.target.rssMb.toFixed(1)} MB RSS · ${cpu} · ${candidate.target.elapsedHours.toFixed(1)} h · ${ports}`;
  }
  const cpu = candidate.target.intervalCpuPercent === null
    ? "unknown CPU"
    : `${candidate.target.intervalCpuPercent.toFixed(1)}% CPU`;
  return `  ${candidate.target.name} · container · ${candidate.target.memoryUsageMb.toFixed(1)} MB · ${cpu} · started ${candidate.target.startedAt}`;
}

function actionLine(candidate: ValidatedCandidateSummary): string {
  if (candidate.protection !== null) {
    const rule = candidate.protection.source === "builtin"
      ? "network-service rule"
      : `user rule ${candidate.protection.name}`;
    return `protected by the ${rule}`;
  }
  if (candidate.decision === "review_required") {
    return "review required before stopping";
  }
  return "eligible after explicit confirmation";
}

function blockedSummary(candidates: readonly ValidatedCandidateSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const failed = candidate.checks.find((check) => !check.passed);
    if (failed === undefined) continue;
    counts.set(failed.name, (counts.get(failed.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => `  ${count} ${name}`);
}

function executionSummaryLines(execution: ExecutionSummary): string[] {
  const counts = new Map<string, number>();
  for (const result of execution.results) {
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  }
  const actions = [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(", ");
  return [
    `execution ${execution.status}: ${execution.reason}`,
    `action results ${actions === "" ? "none" : actions}`,
  ];
}

function reportTitle(report: LocalReport): string {
  if (report.mode === "analyzed") return "Otter analyzed plan";
  return "Otter clean plan";
}

export function renderLocalReport(report: LocalReport, verbose = false): string {
  const analyzer = report.analyzer ?? null;
  const decisionReady = report.validatedCandidates.filter(isDecisionReady);
  const review = decisionReady.filter((candidate) =>
    candidate.decision === "eligible" ||
    candidate.decision === "review_required" ||
    candidate.decision === "protected"
  );
  const blocked = decisionReady.filter((candidate) => candidate.decision === "blocked");
  const topCpu = [...report.topProcesses]
    .sort((left, right) => (right.intervalCpuPercent ?? 0) - (left.intervalCpuPercent ?? 0))[0];
  const topRss = [...report.topProcesses]
    .sort((left, right) => right.rssMb - left.rssMb)[0];

  const lines = [
    `${reportTitle(report)} · run ${report.runId}`,
    "No candidate is executable by default. Memory release is not guaranteed.",
    "",
    "System pressure",
    `  memory free ${report.summary.freeMemoryMb.toFixed(1)} MB of ${report.summary.totalMemoryGb.toFixed(1)} GB`,
    `  swap used ${report.summary.swapUsedMb.toFixed(1)} MB`,
  ];
  if (topCpu !== undefined) {
    const cpu = topCpu.intervalCpuPercent === null
      ? "unknown"
      : `${topCpu.intervalCpuPercent.toFixed(1)}%`;
    lines.push(`  top CPU ${topCpu.executable} ${cpu}`);
  }
  if (topRss !== undefined) {
    lines.push(`  top RSS ${topRss.executable} ${topRss.rssMb.toFixed(1)} MB`);
  }

  lines.push(
    "",
    `Review required · ${review.length} of ${report.candidateCount}`,
  );
  const displayed = verbose ? review : review.slice(0, 9);
  for (const candidate of displayed) {
    lines.push(
      candidateLine(candidate),
      `    impact: ${candidate.impact}; action: ${actionLine(candidate)}`,
    );
  }
  if (!verbose && review.length > displayed.length) {
    lines.push(`  ${review.length - displayed.length} more review candidates omitted`);
  }

  lines.push("", `Blocked summary · ${blocked.length}`);
  lines.push(...blockedSummary(blocked));

  if (verbose) {
    lines.push("", "All blocked candidates");
    for (const candidate of blocked) {
      const reason = candidate.primaryReason ?? "no failed check";
      lines.push(candidateLine(candidate), `    blocked by: ${reason}`);
    }
  }

  if (analyzer !== null && verbose) {
    lines.push(
      "",
      "Analyzer advisory",
      analyzer.summary,
      "",
      "Findings",
      ...analyzer.findings.flatMap((finding) => [
        `${finding.severity}: ${finding.title}`,
        finding.explanation,
        `evidence ${finding.evidenceLevel}`,
      ]),
      "",
      "Unverified, non-executable candidate opinions",
      ...analyzer.candidateOpinions.flatMap((opinion) => [
        `${opinion.candidateId}: ${opinion.assessment}, confidence ${opinion.confidence}`,
        opinion.explanation,
      ]),
      "Opinions cannot create targets, risks, commands, or execution approval.",
    );
  } else if (analyzer !== null) {
    lines.push("", `Analyzer advisory: ${analyzer.summary}`);
  }
  if (report.analyzerError !== null && report.analyzerError !== undefined) {
    lines.push(`analyzer error ${report.analyzerError}`);
  }

  lines.push("", "Details", `  otter trace show ${report.runId}`, "");
  lines.push(...executionSummaryLines(report.execution));
  if (verbose) {
    for (const result of report.execution.results) {
      lines.push(`${result.candidateId}: ${result.status}, ${result.message}`);
    }
    for (const verification of report.execution.verifications ?? []) {
      lines.push(`${verification.candidateId}: ${verification.status}, ${verification.observation}`);
    }
  }
  return lines.map(sanitizeTerminalText).join("\n");
}

export function sanitizeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}
