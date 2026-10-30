import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  confirmationCandidate,
  createTerminalConfirmation,
  type ConfirmationCandidate,
} from "../../src/cli/confirm.ts";
import type { ValidatedCandidate } from "../../src/validator/safety.ts";

function listeningProcessCandidate(): ValidatedCandidate {
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
    decision: "review_required",
    target: {
      kind: "process",
      executable: "node",
      pid: 1059,
      user: "fanfei",
      elapsedHours: 216,
      hasControllingTerminal: false,
      intervalCpuPercent: 0,
      rssMb: 10,
      listeningPorts: [3000],
    },
    checks: [],
    primaryReason: null,
    impact: "Clients using port 3000 lose connectivity when this process stops.",
    observedBenefit: "10.0 MB RSS currently occupied; release is not guaranteed",
    protection: null,
  };
}

function terminallessProcessCandidate(): ValidatedCandidate {
  const listening = listeningProcessCandidate();
  if (listening.target.kind !== "process") throw new Error("fixture must be a process");
  return {
    ...listening,
    target: { ...listening.target, listeningPorts: [] },
    decision: "eligible",
    impact: "Stopping this process may end a user session.",
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
    decision: "review_required",
    target: {
      kind: "container",
      name: "project-cache",
      containerId: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      startedAt: "2026-10-01T00:00:00.000Z",
      state: "running",
      health: "healthy",
      restartPolicy: "no",
      intervalCpuPercent: 0.2,
      memoryUsageMb: 18,
    },
    checks: [],
    primaryReason: null,
    impact: "Stopping this container affects the workload in that container.",
    observedBenefit: "18.0 MB currently occupied; release is not guaranteed",
    protection: null,
  };
}

async function approve(
  candidate: ConfirmationCandidate,
  answer: string,
): Promise<{ approved: boolean; prompt: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const confirmation = createTerminalConfirmation(input, output);
  const result = confirmation.confirm(candidate);
  input.end(`${answer}\n`);
  return { approved: await result, prompt: output.read()?.toString() ?? "" };
}

describe("terminal cleanup confirmation", () => {
  test("a listening process requires its exact executable and PID", async () => {
    const candidate = confirmationCandidate(listeningProcessCandidate());
    const rejected = await approve(candidate, "y");
    const accepted = await approve(candidate, "node 1059");

    expect(rejected.approved).toBe(false);
    expect(accepted.approved).toBe(true);
    expect(accepted.prompt).toContain("This stops node, PID 1059.");
    expect(accepted.prompt).toContain("Clients using port 3000 lose connectivity");
    expect(accepted.prompt).toContain("Type node 1059 to stop this process:");
    expect(accepted.prompt).not.toContain("secret-token-value");
  });

  test("a process with no service impact accepts explicit yes", async () => {
    const result = await approve(confirmationCandidate(terminallessProcessCandidate()), "yes");
    expect(result.approved).toBe(true);
    expect(result.prompt).toContain("Stopping this process may end a user session.");
  });

  test("a container requires its exact name", async () => {
    const candidate = confirmationCandidate(containerCandidate());
    expect((await approve(candidate, "y")).approved).toBe(false);
    const accepted = await approve(candidate, "project-cache");
    expect(accepted.approved).toBe(true);
    expect(accepted.prompt).toContain("This stops container project-cache.");
  });
});
