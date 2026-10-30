import { describe, expect, test } from "bun:test";
import {
  localReportSchema,
  renderLocalReport,
  type LocalReport,
} from "../../src/reporter/local.ts";
import type { ValidatedCandidateSummary } from "../../src/validator/safety.ts";

function candidate(index: number, decision: ValidatedCandidateSummary["decision"]): ValidatedCandidateSummary {
  const failedCheck = index % 3 === 0 ? "stale" : index % 3 === 1 ? "no_active_children" : "not_service_managed";
  return {
    candidateId: `cand_${String(index).padStart(12, "0")}`,
    kind: "process",
    actionType: "kill_process",
    eligibility: decision === "blocked" ? "blocked" : "eligible",
    decision,
    target: {
      kind: "process",
      executable: `process-${index}`,
      pid: 1000 + index,
      user: "fanfei",
      elapsedHours: 9,
      hasControllingTerminal: false,
      intervalCpuPercent: 0.1,
      rssMb: 10 + index,
      listeningPorts: [3000 + (index % 100)],
    },
    checks: decision === "blocked"
      ? [{ name: failedCheck, passed: false, reason: `validator reason ${index}` }]
      : [],
    primaryReason: decision === "blocked" ? `validator reason ${index}` : null,
    impact: "Clients using this port lose connectivity when this process stops.",
    observedBenefit: "10.0 MB RSS currently occupied; release is not guaranteed",
    protection: decision === "protected" ? { name: "clash", source: "builtin" } : null,
  };
}

function report(candidates: readonly ValidatedCandidateSummary[]): LocalReport {
  return localReportSchema.parse({
    schemaVersion: "1.0-local",
    runId: "20261030T063442-7b5d52",
    mode: "local",
    summary: {
      architecture: "arm64",
      macosVersion: "15.1",
      cpuCores: 10,
      totalMemoryGb: 32,
      uptimeHours: 24,
      freeMemoryMb: 512,
      swapUsedMb: 512,
      load1Min: 1.2,
    },
    topProcesses: [{
      executable: "Herdr",
      intervalCpuPercent: 38.2,
      rssMb: 500,
    }],
    listeningPorts: 2,
    docker: { available: true, containerCount: 0, disposableCandidates: 0 },
    candidateCount: candidates.length,
    validatedCandidates: candidates,
    analyzer: null,
    analyzerError: null,
    collectorStatus: [],
    execution: {
      enabled: false,
      status: "disabled",
      reason: "Execution is disabled in settings.",
      results: [],
    },
  });
}

describe("local cleanup report", () => {
  test("keeps a large default plan under fifty lines and aggregates validator checks", () => {
    const review = Array.from({ length: 12 }, (_value, index) => candidate(index, "review_required"));
    const blocked = Array.from({ length: 60 }, (_value, index) => candidate(index + 12, "blocked"));
    const rendered = renderLocalReport(report([...review, ...blocked]));
    const lines = rendered.split("\n");

    expect(lines.length).toBeLessThan(50);
    expect(lines.filter((line) => line.startsWith("  process-")).length).toBe(9);
    expect(lines).toContain("  3 more review candidates omitted");
    expect(lines).toContain("  20 stale");
    expect(lines).toContain("  20 no_active_children");
    expect(lines).toContain("  20 not_service_managed");
    expect(rendered).toContain("Blocked summary · 60");
    expect(rendered).toContain("otter trace show 20261030T063442-7b5d52");
  });

  test("verbose mode shows the complete decision-ready candidate list", () => {
    const candidates = [
      candidate(0, "protected"),
      ...Array.from({ length: 55 }, (_value, index) => candidate(index + 1, "blocked")),
    ];
    const rendered = renderLocalReport(report(candidates), true);
    expect(rendered).toContain("process-0");
    expect(rendered).toContain("protected by the network-service rule");
    expect(rendered.match(/blocked by: validator reason /g)).toHaveLength(55);
  });
});
