import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  confirmationCandidate,
  createTerminalConfirmation,
  type ConfirmationCandidate,
} from "../../src/cli/confirm.ts";
import type { ValidatedCandidate } from "../../src/validator/safety.ts";

function processCandidate(): ValidatedCandidate {
  return {
    candidate: {
      candidateId: "cand_8aacb1da708f",
      kind: "process",
      entityId: "proc_10000059-0000-4000-8000-000000000000",
      pid: 1059,
      startTime: "Wed Oct 29 09:00:00 2025",
      command: "/Users/fanfei/project/bin/node --token secret-token-value",
      user: "fanfei",
      executable: "node",
      intervalCpuPercent: 0,
      rssMb: 10,
      elapsedHours: 216,
      hasControllingTerminal: false,
      listeningPorts: [3000],
    },
    eligibility: { status: "eligible", checks: [] },
    riskLevel: "safe",
    blastRadius: "process candidate, 1 listening port(s)",
    observedBenefit: "10.0 MB RSS currently occupied; release is not guaranteed",
  };
}

function containerCandidate(): ValidatedCandidate {
  return {
    candidate: {
      candidateId: "cand_ddf2af11ba69",
      kind: "container",
      entityId: "container_10000000-0000-4000-8000-000000000000",
      containerId: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      startedAt: "2026-10-01T00:00:00.000Z",
      name: "project-cache",
      state: "running",
      health: "healthy",
      restartPolicy: "no",
      intervalCpuPercent: 0.2,
      memoryUsageMb: 18,
    },
    eligibility: { status: "eligible", checks: [] },
    riskLevel: "safe",
    blastRadius: "container candidate",
    observedBenefit: "18.0 MB RSS currently occupied; release is not guaranteed",
  };
}

async function renderApproval(candidate: ConfirmationCandidate): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  const confirmation = createTerminalConfirmation(input, output);
  const answer = confirmation.confirm(candidate);
  input.end("n\n");
  await answer;
  return output.read()?.toString() ?? "";
}

describe("terminal cleanup confirmation", () => {
  test("identifies a process without exposing its arguments", async () => {
    const text = await renderApproval(confirmationCandidate(processCandidate()));

    expect(text).toContain("target process node, PID 1059");
    expect(text).toContain("owner fanfei");
    expect(text).toContain("running for 216.0 hours");
    expect(text).toContain("CPU 0.00%");
    expect(text).toContain("controlling terminal none");
    expect(text).toContain("listening port 3000");
    expect(text).not.toContain("--token");
    expect(text).not.toContain("secret-token-value");
  });

  test("identifies a disposable container before approval", async () => {
    const text = await renderApproval(confirmationCandidate(containerCandidate()));

    expect(text).toContain("target container project-cache, ID abcdef012345");
    expect(text).toContain("state running");
    expect(text).toContain("health healthy");
    expect(text).toContain("restart policy no");
    expect(text).toContain("CPU 0.20%");
    expect(text).toContain("memory 18.0 MB");
  });
});
