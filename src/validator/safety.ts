import type {
  ContainerInfo,
  ProcessInfo,
} from "../snapshot/schema.ts";
import { parseElapsedSeconds } from "../collectors/parsers.ts";
import type { ContainerCandidate, LocalCandidate, ProcessCandidate } from "../candidates/types.ts";

export type RiskLevel = "safe" | "caution" | "dangerous";

export interface SafetyCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly reason: string;
}

export interface SafetyDecision {
  readonly status: "eligible" | "blocked" | "unknown";
  readonly checks: readonly SafetyCheck[];
}

export interface ValidatedCandidate {
  readonly candidate: LocalCandidate;
  readonly eligibility: SafetyDecision;
  readonly riskLevel: RiskLevel;
  readonly blastRadius: string;
  readonly observedBenefit: string;
}

export interface ValidatedCandidateSummary {
  readonly candidateId: string;
  readonly kind: "process" | "container";
  readonly actionType: "kill_process" | "stop_container";
  readonly eligibility: SafetyDecision["status"];
  readonly riskLevel: RiskLevel;
  readonly blastRadius: string;
  readonly observedBenefit: string;
}

function check(name: string, passed: boolean, reason: string): SafetyCheck {
  return { name, passed, reason };
}

export function validateProcess(
  process: ProcessInfo,
  listeningPorts: readonly number[],
  currentUser: string,
  serviceManagerPids: ReadonlySet<number> | null,
  activeChildCount: number,
): SafetyDecision {
  const activeChildren = activeChildCount;
  const checks = [
    check("user_owned", process.user === currentUser, `owner ${process.user}`),
    check("not_system_user", !process.user.startsWith("_") && process.user !== "root", `owner ${process.user}`),
    check("not_zombie", !process.state.includes("Z"), `state ${process.state}`),
    check(
      "stale",
      process.controllingTerminal === "??" &&
        listeningPorts.length > 0 &&
        parseElapsedSeconds(process.elapsed) >= 8 * 60 * 60 &&
        process.intervalCpuPercent !== null &&
        process.intervalCpuPercent < 1,
      "terminal-less listening process older than eight hours and below one percent CPU",
    ),
    check("no_active_children", activeChildren === 0, `${activeChildren} active children`),
  ];
  if (serviceManagerPids === null) {
    return { status: "unknown", checks: [...checks, check("service_manager", false, "state unknown")] };
  }
  checks.push(check(
    "not_service_managed",
    !serviceManagerPids.has(process.pid),
    serviceManagerPids.has(process.pid) ? "PID appears in launchctl" : "PID is not in launchctl",
  ));
  return {
    status: checks.every((item) => item.passed) ? "eligible" : "blocked",
    checks,
  };
}

export function validateContainer(
  container: ContainerInfo,
  intervalCpuPercent: number | null,
): SafetyDecision {
  const disposable = container.labels["otter.disposable"] === "true";
  const checks = [
    check("disposable", disposable, disposable ? "otter.disposable is true" : "otter.disposable is not true"),
    check(
      "stoppable_state",
      container.state === "running" || container.state === "paused",
      `state ${container.state}`,
    ),
    check(
      "healthy",
      container.health === "healthy" || container.health === "none",
      `health ${container.health}`,
    ),
    check(
      "restart_policy",
      container.restartPolicy === "no" || container.restartPolicy === "on-failure",
      `restart policy ${container.restartPolicy}`,
    ),
    check(
      "idle",
      intervalCpuPercent !== null && intervalCpuPercent < 2,
      intervalCpuPercent === null ? "CPU is unknown" : `${intervalCpuPercent.toFixed(2)}% CPU`,
    ),
  ];
  return {
    status: checks.every((item) => item.passed) ? "eligible" : "blocked",
    checks,
  };
}

export function validateCandidates(
  candidates: readonly LocalCandidate[],
  processes: readonly ProcessInfo[],
  containers: readonly ContainerInfo[],
  portsByPid: ReadonlyMap<number, readonly number[]>,
  currentUser: string,
  serviceManagerPids: ReadonlySet<number> | null,
): readonly ValidatedCandidate[] {
  return candidates.map((candidate): ValidatedCandidate => {
    if (candidate.kind === "process") {
      const process = processes.find((item) => item.entityId === candidate.entityId);
      const activeChildCount = process === undefined
        ? 0
        : processes.filter((item) => item.ppid === process.pid && !item.state.includes("Z")).length;
      const eligibility = process === undefined
        ? { status: "blocked" as const, checks: [check("target_present", false, "process is absent")] }
        : validateProcess(
          process,
          portsByPid.get(process.pid) ?? [],
          currentUser,
          serviceManagerPids,
          activeChildCount,
        );
      return {
        candidate,
        eligibility,
        riskLevel: eligibility.status === "eligible" ? "safe" : "dangerous",
        blastRadius: `process candidate, ${candidate.listeningPorts.length} listening port(s)`,
        observedBenefit: `${candidate.rssMb.toFixed(1)} MB RSS currently occupied; release is not guaranteed`,
      };
    }
    const container = containers.find((item) => item.entityId === candidate.entityId);
    const eligibility = container === undefined
      ? { status: "blocked" as const, checks: [check("target_present", false, "container is absent")] }
      : validateContainer(container, container.intervalCpuPercent);
    return {
      candidate,
      eligibility,
      riskLevel: eligibility.status === "eligible" ? "safe" : "dangerous",
      blastRadius: "container candidate",
      observedBenefit: `${candidate.memoryUsageMb.toFixed(1)} MB currently occupied; release is not guaranteed`,
    };
  });
}

export function summarizeValidatedCandidate(
  validated: ValidatedCandidate,
): ValidatedCandidateSummary {
  return {
    candidateId: validated.candidate.candidateId,
    kind: validated.candidate.kind,
    actionType: validated.candidate.kind === "process" ? "kill_process" : "stop_container",
    eligibility: validated.eligibility.status,
    riskLevel: validated.riskLevel,
    blastRadius: validated.blastRadius,
    observedBenefit: validated.observedBenefit,
  };
}

export type { ProcessCandidate, ContainerCandidate };
