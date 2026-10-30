import { z } from "zod";
import type { RedactedPayload } from "../redactor/schema.ts";

export const analyzerResponseSchema = z.strictObject({
  summary: z.string().min(1),
  findings: z.array(z.strictObject({
    id: z.string().min(1),
    severity: z.enum(["info", "warning", "critical"]),
    evidenceLevel: z.enum(["measured", "supported_hypothesis", "unsupported_inference"]),
    title: z.string().min(1),
    explanation: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })),
  candidateOpinions: z.array(z.strictObject({
    candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
    assessment: z.enum(["likely_useful", "unclear", "likely_not_useful"]),
    confidence: z.enum(["low", "medium", "high"]),
    explanation: z.string().min(1),
  })),
});

export type AnalyzerReport = z.infer<typeof analyzerResponseSchema>;

export type AnalyzerValidation =
  | { readonly status: "valid"; readonly report: AnalyzerReport }
  | { readonly status: "invalid"; readonly errors: readonly string[] };

function allowedEvidenceRefs(payload: RedactedPayload): ReadonlySet<string> {
  const refs = new Set<string>([
    "machine",
    "machine.cpuCores",
    "machine.totalMemoryGb",
    "machine.uptimeHours",
    "memory",
    "memory.freeMb",
    "memory.compressedMb",
    "memory.swapUsedMb",
    "load.oneMinute",
    "load.fiveMinute",
    "load.fifteenMinute",
    "ports",
    "docker",
    "docker.vmProcess",
  ]);
  for (const process of [...payload.processTiers.detail, ...payload.processTiers.candidates]) {
    refs.add(process.entityId);
  }
  for (const container of payload.docker.containers) refs.add(container.entityId);
  for (const candidate of payload.candidateBook) refs.add(candidate.candidateId);
  return refs;
}

export function validateAnalyzerResponse(
  value: unknown,
  payload: RedactedPayload,
): AnalyzerValidation {
  const parsed = analyzerResponseSchema.safeParse(value);
  if (!parsed.success) {
    return {
      status: "invalid",
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  const candidateIds = new Set(payload.candidateBook.map((candidate) => candidate.candidateId));
  const refs = allowedEvidenceRefs(payload);
  const errors: string[] = [];
  for (const finding of parsed.data.findings) {
    for (const ref of finding.evidenceRefs) {
      if (!refs.has(ref)) errors.push(`unknown evidence ref ${ref}`);
    }
  }
  for (const opinion of parsed.data.candidateOpinions) {
    if (!candidateIds.has(opinion.candidateId)) {
      errors.push(`unknown candidate ref ${opinion.candidateId}`);
    }
  }
  return errors.length === 0
    ? { status: "valid", report: parsed.data }
    : { status: "invalid", errors };
}
