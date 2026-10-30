import { createInterface } from "node:readline/promises";
import type { Readable } from "node:stream";
import { sanitizeTerminalText } from "../reporter/local.ts";
import {
  summarizeValidatedCandidate,
  type ValidatedCandidate,
  type ValidatedCandidateSummary,
} from "../validator/safety.ts";

export type ConfirmationCandidate = ValidatedCandidateSummary;

export interface ConfirmationAdapter {
  confirm(candidate: ConfirmationCandidate): Promise<boolean>;
}

export function confirmationCandidate(
  validated: ValidatedCandidate,
): ConfirmationCandidate {
  return summarizeValidatedCandidate(validated);
}

function approvalAnswer(candidate: ConfirmationCandidate): string {
  if (candidate.target.kind === "process" && candidate.target.listeningPorts.length === 0) {
    return "y";
  }
  return candidate.target.kind === "process"
    ? `${candidate.target.executable} ${candidate.target.pid}`
    : candidate.target.name;
}

function consequenceLines(candidate: ConfirmationCandidate): string[] {
  return [
    candidate.target.kind === "process"
      ? `This stops ${candidate.target.executable}, PID ${candidate.target.pid}.`
      : `This stops container ${candidate.target.name}.`,
    candidate.impact,
    candidate.observedBenefit,
    "",
    `Type ${approvalAnswer(candidate)} to ${candidate.actionType === "kill_process" ? "stop this process" : "stop this container"}: `,
  ];
}

function detailLines(candidate: ConfirmationCandidate): string[] {
  const target = candidate.target;
  if (target.kind === "process") {
    const cpu = target.intervalCpuPercent === null
      ? "unknown"
      : `${target.intervalCpuPercent.toFixed(2)}%`;
    return [
      `candidate ${candidate.candidateId}`,
      `decision ${candidate.decision.replace(/_/g, " ")}`,
      `target process ${target.executable}, PID ${target.pid}`,
      `owner ${target.user}`,
      `running for ${target.elapsedHours.toFixed(1)} hours`,
      `CPU ${cpu}`,
      `memory ${target.rssMb.toFixed(1)} MB RSS`,
      `controlling terminal ${target.hasControllingTerminal ? "present" : "none"}`,
      target.listeningPorts.length === 0
        ? "listening ports none"
        : `listening ${target.listeningPorts.length === 1 ? "port" : "ports"} ${target.listeningPorts.join(", ")}`,
    ];
  }
  const cpu = target.intervalCpuPercent === null
    ? "unknown"
    : `${target.intervalCpuPercent.toFixed(2)}%`;
  return [
    `candidate ${candidate.candidateId}`,
    `decision ${candidate.decision.replace(/_/g, " ")}`,
    `target container ${target.name}, ID ${target.containerId.slice(0, 12)}`,
    `state ${target.state}`,
    `health ${target.health}`,
    `restart policy ${target.restartPolicy}`,
    `CPU ${cpu}`,
    `memory ${target.memoryUsageMb.toFixed(1)} MB`,
  ];
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
            ...detailLines(candidate),
            "",
            ...consequenceLines(candidate),
          ]
            .map(sanitizeTerminalText)
            .join("\n"),
        );
        const expected = approvalAnswer(candidate);
        const provided = answer.trim();
        return expected === "y"
          ? provided.toLowerCase() === "y" || provided.toLowerCase() === "yes"
          : provided === expected;
      } finally {
        line.close();
      }
    },
  };
}
