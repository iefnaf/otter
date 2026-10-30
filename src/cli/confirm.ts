import { createInterface } from "node:readline/promises";
import type { Readable } from "node:stream";
import { sanitizeTerminalText } from "../reporter/local.ts";
import {
  summarizeValidatedCandidate,
  type ValidatedCandidate,
  type ValidatedCandidateSummary,
} from "../validator/safety.ts";

export interface ConfirmationAdapter {
  confirm(candidate: ConfirmationCandidate): Promise<boolean>;
}

export type ConfirmationTarget =
  | {
    readonly kind: "process";
    readonly executable: string;
    readonly pid: number;
    readonly user: string;
    readonly elapsedHours: number;
    readonly hasControllingTerminal: boolean;
    readonly intervalCpuPercent: number | null;
    readonly listeningPorts: readonly number[];
  }
  | {
    readonly kind: "container";
    readonly name: string;
    readonly containerId: string;
    readonly state: string;
    readonly health: string;
    readonly restartPolicy: string;
    readonly intervalCpuPercent: number | null;
    readonly memoryUsageMb: number;
  };

export interface ConfirmationCandidate extends ValidatedCandidateSummary {
  readonly target: ConfirmationTarget;
}

export function confirmationCandidate(validated: ValidatedCandidate): ConfirmationCandidate {
  const summary = summarizeValidatedCandidate(validated);
  if (validated.candidate.kind === "process") {
    return {
      ...summary,
      target: {
        kind: "process",
        executable: validated.candidate.executable,
        pid: validated.candidate.pid,
        user: validated.candidate.user,
        elapsedHours: validated.candidate.elapsedHours,
        hasControllingTerminal: validated.candidate.hasControllingTerminal,
        intervalCpuPercent: validated.candidate.intervalCpuPercent,
        listeningPorts: [...validated.candidate.listeningPorts],
      },
    };
  }
  return {
    ...summary,
    target: {
      kind: "container",
      name: validated.candidate.name,
      containerId: validated.candidate.containerId,
      state: validated.candidate.state,
      health: validated.candidate.health,
      restartPolicy: validated.candidate.restartPolicy,
      intervalCpuPercent: validated.candidate.intervalCpuPercent,
      memoryUsageMb: validated.candidate.memoryUsageMb,
    },
  };
}

export function createTerminalConfirmation(
  input: Readable,
  output: NodeJS.WritableStream,
): ConfirmationAdapter {
  return {
    async confirm(candidate) {
      const line = createInterface({ input, output });
      try {
        const answer = await line.question(
          [
            "Otter cleanup candidate",
            `candidate ${candidate.candidateId}`,
            `action ${candidate.actionType}`,
            `risk ${candidate.riskLevel}`,
            ...targetLines(candidate.target),
            `blast radius ${candidate.blastRadius}`,
            `measured benefit ${candidate.observedBenefit}`,
            "Approve this exact candidate? [y/N] ",
          ].map(sanitizeTerminalText).join("\n"),
        );
        return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      } finally {
        line.close();
      }
    },
  };
}

function targetLines(target: ConfirmationTarget): string[] {
  if (target.kind === "process") {
    const cpu = target.intervalCpuPercent === null
      ? "unknown"
      : `${target.intervalCpuPercent.toFixed(1)}%`;
    return [
      `target process ${target.executable}, PID ${target.pid}`,
      `owner ${target.user}`,
      `running for ${target.elapsedHours.toFixed(1)} hours`,
      `CPU ${cpu}`,
      `controlling terminal ${target.hasControllingTerminal ? "present" : "none"}`,
      `listening ${target.listeningPorts.length === 1 ? "port" : "ports"} ${target.listeningPorts.join(", ")}`,
    ];
  }
  const cpu = target.intervalCpuPercent === null
    ? "unknown"
    : `${target.intervalCpuPercent.toFixed(1)}%`;
  return [
    `target container ${target.name}, ID ${target.containerId.slice(0, 12)}`,
    `state ${target.state}`,
    `health ${target.health}`,
    `restart policy ${target.restartPolicy}`,
    `CPU ${cpu}`,
    `memory ${target.memoryUsageMb.toFixed(1)} MB`,
  ];
}
