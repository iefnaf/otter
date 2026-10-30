import type { CommandRunner } from "../collectors/types.ts";
import { parseDockerInspection } from "../collectors/parsers.ts";
import type { ContainerCandidate, ProcessCandidate } from "../candidates/types.ts";
import {
  revalidateContainerCandidate,
  revalidateProcessCandidate,
  type RevalidationResult,
} from "../validator/revalidate.ts";
import type { ExecutionResult, ProcessControl } from "./types.ts";

export const localProcessControl: ProcessControl = {
  kill(pid, signal) {
    process.kill(pid, signal);
  },
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

export interface ExecutorOptions {
  readonly runner: CommandRunner;
  readonly currentUser: string;
  readonly processControl?: ProcessControl;
  readonly waitMs?: (milliseconds: number) => Promise<void>;
  readonly revalidationWindowSeconds?: number;
}

function result(
  candidateId: string,
  actionType: "kill_process" | "stop_container",
  status: ExecutionResult["status"],
  message: string,
  errorCode: string | null = null,
): ExecutionResult {
  return { candidateId, actionType, status, errorCode, message };
}

function changed(
  candidateId: string,
  actionType: "kill_process" | "stop_container",
  revalidation: RevalidationResult,
): ExecutionResult | null {
  if (revalidation.status === "already_done") {
    return result(candidateId, actionType, "skipped", "Target was already gone.", "TARGET_GONE");
  }
  if (revalidation.status === "target_changed") {
    return result(candidateId, actionType, "target_changed", revalidation.reason, "TARGET_CHANGED");
  }
  if (revalidation.status === "unknown") {
    return result(candidateId, actionType, "failed", revalidation.reason, "UNKNOWN_STATE");
  }
  return null;
}

export async function killProcess(
  candidate: ProcessCandidate,
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  const control = options.processControl ?? localProcessControl;
  const wait = options.waitMs ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const first = await revalidateProcessCandidate(
    candidate,
    options.runner,
    options.currentUser,
    options.revalidationWindowSeconds,
  );
  const firstChange = changed(candidate.candidateId, "kill_process", first);
  if (firstChange !== null) return firstChange;

  try {
    control.kill(candidate.pid, "SIGTERM");
  } catch {
    return result(
      candidate.candidateId,
      "kill_process",
      "failed",
      "sending SIGTERM failed",
      "SIGTERM_FAILED",
    );
  }
  await wait(3000);
  if (!control.alive(candidate.pid)) {
    return result(candidate.candidateId, "kill_process", "succeeded", "Process exited after SIGTERM.");
  }

  const second = await revalidateProcessCandidate(
    candidate,
    options.runner,
    options.currentUser,
    options.revalidationWindowSeconds,
  );
  if (second.status === "target_changed") {
    return result(candidate.candidateId, "kill_process", "target_changed", second.reason, "TARGET_CHANGED");
  }
  if (second.status === "already_done") {
    return result(candidate.candidateId, "kill_process", "succeeded", "Process exited after SIGTERM.");
  }
  if (second.status === "unknown") {
    return result(candidate.candidateId, "kill_process", "partially_succeeded", second.reason, "UNKNOWN_AFTER_SIGTERM");
  }
  try {
    control.kill(candidate.pid, "SIGKILL");
  } catch {
    return result(
      candidate.candidateId,
      "kill_process",
      "partially_succeeded",
      "sending SIGKILL failed after SIGTERM",
      "SIGKILL_FAILED",
    );
  }
  await wait(200);
  return control.alive(candidate.pid)
    ? result(candidate.candidateId, "kill_process", "partially_succeeded", "Process remained alive after SIGKILL.", "SIGKILL_TIMEOUT")
    : result(candidate.candidateId, "kill_process", "succeeded", "Process exited after SIGKILL.");
}

export async function stopContainer(
  candidate: ContainerCandidate,
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  const first = await revalidateContainerCandidate(
    candidate,
    options.runner,
    options.revalidationWindowSeconds,
  );
  const firstChange = changed(candidate.candidateId, "stop_container", first);
  if (firstChange !== null) return firstChange;

  const stopped = await options.runner(
    "docker",
    ["stop", candidate.containerId],
    { timeoutMs: 15_000 },
  );
  if (stopped.exitCode !== 0) {
    return result(
      candidate.candidateId,
      "stop_container",
      "failed",
      `docker stop exited with code ${stopped.exitCode}`,
      "DOCKER_STOP_FAILED",
    );
  }
  const inspect = await options.runner(
    "docker",
    ["inspect", "--format", "{{json .}}", candidate.containerId],
    { timeoutMs: 10_000 },
  );
  if (inspect.exitCode !== 0) {
    return result(candidate.candidateId, "stop_container", "partially_succeeded", "docker stop succeeded but verification failed.", "VERIFY_FAILED");
  }
  let state: "running" | "paused" | "exited" | "restarting";
  try {
    state = parseDockerInspection(inspect.stdout).state;
  } catch {
    return result(candidate.candidateId, "stop_container", "partially_succeeded", "docker stop succeeded but verification output was invalid.", "VERIFY_FAILED");
  }
  return state === "exited"
    ? result(candidate.candidateId, "stop_container", "succeeded", "Container is stopped.")
    : result(candidate.candidateId, "stop_container", "partially_succeeded", `Container state is ${state}.`, "CONTAINER_ACTIVE");
}
