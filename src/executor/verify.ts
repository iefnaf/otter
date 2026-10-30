import type { CommandRunner } from "../collectors/types.ts";
import { parseDockerInspection } from "../collectors/parsers.ts";
import type { LocalCandidate, ProcessCandidate } from "../candidates/types.ts";
import { revalidateProcessCandidate } from "../validator/revalidate.ts";

export interface ActionVerification {
  readonly candidateId: string;
  readonly status: "verified" | "active" | "unknown";
  readonly observation: string;
}

export interface VerificationOptions {
  readonly runner: CommandRunner;
  readonly currentUser: string;
  readonly revalidationWindowSeconds?: number;
}

function verification(
  candidateId: string,
  status: ActionVerification["status"],
  observation: string,
): ActionVerification {
  return { candidateId, status, observation };
}

async function verifyProcess(
  candidate: ProcessCandidate,
  options: VerificationOptions,
): Promise<ActionVerification> {
  const result = await revalidateProcessCandidate(
    candidate,
    options.runner,
    options.currentUser,
    options.revalidationWindowSeconds,
  );
  if (result.status === "already_done") {
    return verification(candidate.candidateId, "verified", "Short-term observation: target is absent.");
  }
  if (result.status === "ok") {
    return verification(candidate.candidateId, "active", "Short-term observation: target is still present.");
  }
  return verification(
    candidate.candidateId,
    "unknown",
    `Short-term observation could not confirm target state: ${result.reason}.`,
  );
}

export async function verifyAction(
  candidate: LocalCandidate,
  options: VerificationOptions,
): Promise<ActionVerification> {
  try {
    if (candidate.kind === "process") return await verifyProcess(candidate, options);
    const inspect = await options.runner(
      "docker",
      ["inspect", "--format", "{{json .}}", candidate.containerId],
      { timeoutMs: 10_000 },
    );
    if (inspect.exitCode !== 0) {
      return verification(candidate.candidateId, "unknown", "Short-term observation: docker inspect failed.");
    }
    const inspection = parseDockerInspection(inspect.stdout);
    return inspection.state === "exited"
      ? verification(candidate.candidateId, "verified", "Short-term observation: container is stopped.")
      : verification(
        candidate.candidateId,
        "active",
        `Short-term observation: container state is ${inspection.state}.`,
      );
  } catch {
    return verification(
      candidate.candidateId,
      "unknown",
      "Short-term observation could not be parsed.",
    );
  }
}
