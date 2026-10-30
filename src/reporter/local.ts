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

export function renderLocalReport(report: LocalReport): string {
  const analyzer = report.analyzer ?? null;
  const lines = [
    ...(analyzer === null
      ? []
      : [
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
          "",
        ]),
    "Otter local snapshot",
    `run ${report.runId}`,
    `system ${report.summary.architecture}, macOS ${report.summary.macosVersion}, ${report.summary.cpuCores} cores`,
    `memory free ${report.summary.freeMemoryMb.toFixed(1)} MB of ${report.summary.totalMemoryGb.toFixed(1)} GB`,
    `swap used ${report.summary.swapUsedMb.toFixed(1)} MB`,
    `load ${report.summary.load1Min.toFixed(2)}, uptime ${report.summary.uptimeHours.toFixed(1)} hours`,
    "",
    "Top processes",
  ];
  for (const process of report.topProcesses) {
    const cpu = process.intervalCpuPercent === null ? "new" : process.intervalCpuPercent.toFixed(1);
    lines.push(`${process.executable}: ${cpu}% CPU, ${process.rssMb.toFixed(1)} MB RSS`);
  }
  lines.push("");
  lines.push(`listening TCP ports ${report.listeningPorts}`);
  lines.push(`Docker available ${report.docker.available}, containers ${report.docker.containerCount}`);
  lines.push(`local candidates ${report.validatedCandidates.length} of ${report.candidateCount}`);
  for (const candidate of report.validatedCandidates) {
    lines.push(`${candidate.candidateId}: ${candidate.actionType}, ${candidate.eligibility}, ${candidate.riskLevel}`);
    lines.push(`blast radius ${candidate.blastRadius}`);
    lines.push(candidate.observedBenefit);
  }
  if (report.analyzerError !== null && report.analyzerError !== undefined) {
    lines.push(`analyzer error ${report.analyzerError}`);
  }
  lines.push(`execution ${report.execution.status}: ${report.execution.reason}`);
  for (const result of report.execution.results) {
    lines.push(`${result.candidateId}: ${result.status}, ${result.message}`);
  }
  for (const verification of report.execution.verifications ?? []) {
    lines.push(`${verification.candidateId}: ${verification.status}, ${verification.observation}`);
  }
  return lines.map(sanitizeTerminalText).join("\n");
}

export function sanitizeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}
