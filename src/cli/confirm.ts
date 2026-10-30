import { createInterface } from "node:readline/promises";
import type { Readable } from "node:stream";
import type { ValidatedCandidateSummary } from "../validator/safety.ts";

export interface ConfirmationAdapter {
  confirm(candidate: ValidatedCandidateSummary): Promise<boolean>;
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
            `blast radius ${candidate.blastRadius}`,
            `measured benefit ${candidate.observedBenefit}`,
            "Approve this exact candidate? [y/N] ",
          ].join("\n"),
        );
        return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      } finally {
        line.close();
      }
    },
  };
}
