import { describe, expect, test } from "bun:test";
import { validateAnalyzerResponse } from "../../src/analyzer/response.ts";
import { redactSnapshot } from "../../src/redactor/redact.ts";
import { snapshotFixture } from "../helpers.ts";

describe("analyzer response validation", () => {
  test("accepts only findings and opinions that resolve to outbound references", () => {
    const payload = redactSnapshot(snapshotFixture(), {
      runId: "20261030T000000-abcdef",
      currentUser: "fanfei",
    }).payload;
    const candidateId = payload.candidateBook[0]?.candidateId;
    if (candidateId === undefined) throw new Error("fixture has no candidate");
    const valid = validateAnalyzerResponse({
      summary: "Memory pressure is elevated.",
      findings: [{
        id: "memory",
        severity: "warning",
        evidenceLevel: "measured",
        title: "Current swap use",
        explanation: "The snapshot reports current swap use.",
        evidenceRefs: [
          "memory.swapUsedMb",
          "memory.activeMb",
          "docker.daemonAvailable",
          "collectorStatus",
        ],
      }],
      candidateOpinions: [{
        candidateId,
        assessment: "unclear",
        confidence: "low",
        explanation: "The measured facts do not establish usefulness.",
      }],
    }, payload);
    expect(valid.status).toBe("valid");

    const invalid = validateAnalyzerResponse({
      summary: "invalid",
      findings: [],
      candidateOpinions: [],
      recommendations: [{ actionType: "kill_process" }],
    }, payload);
    expect(invalid.status).toBe("invalid");
    const unknown = validateAnalyzerResponse({
      summary: "invalid",
      findings: [],
      candidateOpinions: [{
        candidateId: "cand_000000000000",
        assessment: "unclear",
        confidence: "low",
        explanation: "no such candidate",
      }],
    }, payload);
    expect(unknown.status).toBe("invalid");
  });
});
