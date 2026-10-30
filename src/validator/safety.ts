import type {
  ContainerInfo,
  ProcessInfo,
} from "../snapshot/schema.ts";
import { parseElapsedSeconds } from "../collectors/parsers.ts";
import type { ContainerCandidate, LocalCandidate, ProcessCandidate } from "../candidates/types.ts";
import type {
  CandidateDecision,
  CandidateTarget,
  DecisionReadyCandidateSummary,
  SafetyCheck,
} from "./schema.ts";
import {
  matchProtection,
  protectionRules,
  type ProtectionMatch,
} from "./protection.ts";

export type { CandidateDecision, SafetyCheck };

export interface SafetyDecision {
  readonly status: "eligible" | "blocked" | "protected" | "unknown";
  readonly checks: readonly SafetyCheck[];
}

export interface ValidatedCandidate {
  readonly candidate: LocalCandidate;
  readonly eligibility: SafetyDecision;
  readonly decision: CandidateDecision;
  readonly target: CandidateTarget;
  readonly checks: readonly SafetyCheck[];
  readonly primaryReason: string | null;
  readonly impact: string;
  readonly observedBenefit: string;
  readonly protection: ProtectionMatch | null;
}

export type ValidatedCandidateSummary = DecisionReadyCandidateSummary;

function check(name: string, passed: boolean, reason: string): SafetyCheck {
  return { name, passed, reason };
}

function firstReason(checks: readonly SafetyCheck[]): string | null {
  return checks.find((item) => !item.passed)?.reason ?? null;
}

function processTarget(candidate: ProcessCandidate): CandidateTarget {
  return {
    kind: "process",
    executable: candidate.executable,
    pid: candidate.pid,
    user: candidate.user,
    elapsedHours: candidate.elapsedHours,
    hasControllingTerminal: candidate.hasControllingTerminal,
    intervalCpuPercent: candidate.intervalCpuPercent,
    rssMb: candidate.rssMb,
    listeningPorts: [...candidate.listeningPorts],
  };
}

function containerTarget(candidate: ContainerCandidate): CandidateTarget {
  return {
    kind: "container",
    name: candidate.name,
    containerId: candidate.containerId,
    startedAt: candidate.startedAt,
    state: candidate.state,
    health: candidate.health,
    restartPolicy: candidate.restartPolicy,
    intervalCpuPercent: candidate.intervalCpuPercent,
    memoryUsageMb: candidate.memoryUsageMb,
  };
}

function processImpact(candidate: ProcessCandidate): string {
  return candidate.listeningPorts.length === 0
    ? "Stopping this process may end a user session."
    : `Clients using port ${candidate.listeningPorts.join(", ")} lose connectivity when this process stops.`;
}

function actionDecision(
  eligibility: SafetyDecision,
  target: CandidateTarget,
  protection: ProtectionMatch | null,
): CandidateDecision {
  if (protection !== null) return "protected";
  if (eligibility.status !== "eligible") return "blocked";
  if (target.kind === "container") return "review_required";
  if (target.listeningPorts.length > 0) return "review_required";
  return "eligible";
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
    check(
      "not_system_user",
      !process.user.startsWith("_") && process.user !== "root",
      `owner ${process.user}`,
    ),
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
    check(
      "no_active_children",
      activeChildren === 0,
      `${activeChildren} active children`,
    ),
  ];
  if (serviceManagerPids === null) {
    return {
      status: "unknown",
      checks: [...checks, check("service_manager", false, "state unknown")],
    };
  }
  checks.push(check(
    "not_service_managed",
    !serviceManagerPids.has(process.pid),
    serviceManagerPids.has(process.pid)
      ? "PID appears in launchctl"
      : "PID is not in launchctl",
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
    check(
      "disposable",
      disposable,
      disposable ? "otter.disposable is true" : "otter.disposable is not true",
    ),
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
      intervalCpuPercent === null
        ? "CPU is unknown"
        : `${intervalCpuPercent.toFixed(2)}% CPU`,
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
  protectedExecutables: readonly string[] = [],
): readonly ValidatedCandidate[] {
  const rules = protectionRules(protectedExecutables);
  return candidates.map((candidate): ValidatedCandidate => {
    if (candidate.kind === "process") {
      const process = processes.find((item) => item.entityId === candidate.entityId);
      const activeChildCount = process === undefined
        ? 0
        : processes.filter((item) => item.ppid === process.pid && !item.state.includes("Z")).length;
      const eligibility = process === undefined
        ? {
          status: "blocked" as const,
          checks: [check("target_present", false, "process is absent")],
        }
        : validateProcess(
          process,
          portsByPid.get(process.pid) ?? [],
          currentUser,
          serviceManagerPids,
          activeChildCount,
        );
      const target = processTarget(candidate);
      const protection = matchProtection(candidate.executable, rules);
      const protectedEligibility = protection === null
        ? eligibility
        : { ...eligibility, status: "protected" as const };
      const checks = [...eligibility.checks];
      return {
        candidate,
        eligibility: protectedEligibility,
        decision: actionDecision(eligibility, target, protection),
        target,
        checks,
        primaryReason: firstReason(checks),
        impact: processImpact(candidate),
        observedBenefit: `${candidate.rssMb.toFixed(1)} MB RSS currently occupied; release is not guaranteed`,
        protection,
      };
    }

    const container = containers.find((item) => item.entityId === candidate.entityId);
    const eligibility = container === undefined
      ? {
        status: "blocked" as const,
        checks: [check("target_present", false, "container is absent")],
      }
      : validateContainer(container, container.intervalCpuPercent);
    const target = containerTarget(candidate);
    const checks = [...eligibility.checks];
    return {
      candidate,
      eligibility,
      decision: actionDecision(eligibility, target, null),
      target,
      checks,
      primaryReason: firstReason(checks),
      impact: "Stopping this container affects the workload in that container.",
      observedBenefit: `${candidate.memoryUsageMb.toFixed(1)} MB currently occupied; release is not guaranteed`,
      protection: null,
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
    decision: validated.decision,
    target: validated.target,
    checks: [...validated.checks],
    primaryReason: validated.primaryReason,
    impact: validated.impact,
    observedBenefit: validated.observedBenefit,
    protection: validated.protection,
  };
}

export type { ProcessCandidate, ContainerCandidate };
