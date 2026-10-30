import { describe, expect, test } from "bun:test";
import { buildAnalyzerPrompt } from "../../src/analyzer/prompt.ts";
import { redactSnapshot } from "../../src/redactor/redact.ts";
import { snapshotFixture } from "../helpers.ts";

describe("analyzer prompt", () => {
  test("states the exact response schema the validator accepts", () => {
    const { payload } = redactSnapshot(snapshotFixture(), {
      runId: "20261030T000000-abcdef",
      currentUser: "fanfei",
    });
    const prompt = buildAnalyzerPrompt(payload, "scan");

    expect(prompt).toContain(
      "Every findings item uses these keys: id, severity, evidenceLevel, title, explanation, evidenceRefs.",
    );
    expect(prompt).toContain("severity must be one of info, warning, critical.");
    expect(prompt).toContain(
      "evidenceLevel must be one of measured, supported_hypothesis, unsupported_inference.",
    );
    expect(prompt).toContain(
      "assessment must be one of likely_useful, unclear, likely_not_useful.",
    );
    expect(prompt).toContain("confidence must be one of low, medium, high.");
    expect(prompt).toContain("Return at most 8 findings and at most 10 candidateOpinions.");
    expect(prompt).toContain(
      "Keep summary to four sentences and every explanation to two sentences.",
    );
  });
});
