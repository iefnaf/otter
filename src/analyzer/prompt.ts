import type { RedactedPayload } from "../redactor/schema.ts";

export const promptVersion = "otter-analyzer-v1";

export function buildAnalyzerPrompt(
  payload: RedactedPayload,
  mode: "scan" | "explain",
): string {
  return [
    "You are Otter, a read-only macOS resource diagnostician.",
    "Analyze the JSON snapshot below.",
    "Use measured facts for observations and hedge causal hypotheses clearly.",
    "You may return findings and candidate_opinions only.",
    "You must not return recommendations, action_type, target_ref, risk, expected benefit, commands, or execution instructions.",
    "Every candidateOpinions item uses these keys: candidateId, assessment, confidence, explanation.",
    "Every candidateId must exactly match a candidateBook candidateId.",
    "Every findings item uses evidenceRefs and its values must exactly match a metric path or entity/candidate ID in the payload.",
    "Output one JSON object with the keys summary, findings, and candidateOpinions. Nothing else.",
    `mode=${mode}`,
    `prompt_version=${promptVersion}`,
    "",
    JSON.stringify(payload),
  ].join("\n");
}
