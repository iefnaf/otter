import type { RedactedPayload } from "../redactor/schema.ts";

export const promptVersion = "otter-analyzer-v2";

export function buildAnalyzerPrompt(
  payload: RedactedPayload,
  mode: "scan" | "explain",
): string {
  return [
    "You are Otter, a read-only macOS resource diagnostician.",
    "Analyze the JSON snapshot below.",
    "Use measured facts for observations and hedge causal hypotheses clearly.",
    "Return at most 8 findings and at most 10 candidateOpinions. Choose the most relevant items.",
    "Keep summary to four sentences and every explanation to two sentences.",
    "You must not return recommendations, action_type, target_ref, risk, expected benefit, commands, or execution instructions.",
    "Every findings item uses these keys: id, severity, evidenceLevel, title, explanation, evidenceRefs.",
    "summary, id, title, and explanation values must be nonempty strings. evidenceRefs must contain at least one nonempty string.",
    "severity must be one of info, warning, critical.",
    "evidenceLevel must be one of measured, supported_hypothesis, unsupported_inference.",
    "Every evidenceRefs value must exactly match a metric path or entity/candidate ID in the payload.",
    "Every candidateOpinions item uses these keys: candidateId, assessment, confidence, explanation.",
    "Every candidateId must exactly match a candidateBook candidateId.",
    "assessment must be one of likely_useful, unclear, likely_not_useful.",
    "confidence must be one of low, medium, high.",
    "Output one JSON object with the keys summary, findings, and candidateOpinions. Nothing else.",
    `mode=${mode}`,
    `prompt_version=${promptVersion}`,
    "",
    JSON.stringify(payload),
  ].join("\n");
}
