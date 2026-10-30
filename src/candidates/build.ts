import { createHash } from "node:crypto";
import { basename } from "node:path";
import { parseElapsedSeconds } from "../collectors/parsers.ts";
import type { SystemSnapshot } from "../snapshot/schema.ts";
import type { CandidateFact } from "../redactor/schema.ts";
import type { CandidateBook, LocalCandidate } from "./types.ts";

function hash(value: string, runId: string): string {
  return createHash("sha256").update(`${runId}:${value}`).digest("hex").slice(0, 12);
}

function candidateId(kind: string, localId: string, runId: string): string {
  return `cand_${hash(`${kind}:${localId}`, runId)}`;
}

export function executableName(command: string): string {
  const firstArgument = command.trim().split(/\s+/)[0] ?? "";
  return basename(firstArgument) || "unknown";
}

export function buildCandidateBook(
  snapshot: SystemSnapshot,
  currentUser: string,
  runId: string,
): CandidateBook {
  const listeningByPid = new Map<number, number[]>();
  for (const port of snapshot.ports) {
    const ports = listeningByPid.get(port.pid) ?? [];
    ports.push(port.port);
    listeningByPid.set(port.pid, ports);
  }

  const processCandidates = snapshot.processes
    .filter((process) => process.user === currentUser)
    .filter((process) => {
      const ports = listeningByPid.get(process.pid);
      const terminalless = process.controllingTerminal === "??";
      const longRunning = parseElapsedSeconds(process.elapsed) >= 4 * 60 * 60;
      return ports !== undefined || terminalless || longRunning;
    })
    .map((process): LocalCandidate => ({
      candidateId: candidateId("process", process.entityId, runId),
      kind: "process",
      entityId: process.entityId,
      pid: process.pid,
      startTime: process.startTime,
      command: process.command,
      user: process.user,
      executable: executableName(process.command),
      intervalCpuPercent: process.intervalCpuPercent,
      rssMb: process.rssMb,
      elapsedHours: parseElapsedSeconds(process.elapsed) / 3600,
      hasControllingTerminal: process.controllingTerminal !== "??",
      listeningPorts: listeningByPid.get(process.pid) ?? [],
    }));

  const containerCandidates = snapshot.docker.containers
    .filter((container) => container.labels["otter.disposable"] === "true")
    .map((container): LocalCandidate => ({
      candidateId: candidateId("container", container.entityId, runId),
      kind: "container",
      entityId: container.entityId,
      containerId: container.id,
      startedAt: container.startedAt,
      name: container.name,
      state: container.state,
      health: container.health,
      restartPolicy: container.restartPolicy,
      intervalCpuPercent: container.intervalCpuPercent,
      memoryUsageMb: container.memoryUsageMb,
    }));

  const records = [...processCandidates, ...containerCandidates];
  return { records, facts: records.map(publicFact) };
}

function publicFact(candidate: LocalCandidate): CandidateFact {
  if (candidate.kind === "process") {
    return {
      candidateId: candidate.candidateId,
      kind: "process",
      executable: candidate.executable,
      intervalCpuPercent: candidate.intervalCpuPercent,
      rssMb: candidate.rssMb,
      elapsedHours: candidate.elapsedHours,
      hasControllingTerminal: candidate.hasControllingTerminal,
      listeningPorts: [...candidate.listeningPorts],
    };
  }
  return {
    candidateId: candidate.candidateId,
    kind: "container",
    state: candidate.state,
    health: candidate.health,
    restartPolicy: candidate.restartPolicy,
    intervalCpuPercent: candidate.intervalCpuPercent,
    memoryUsageMb: candidate.memoryUsageMb,
    disposable: true,
  };
}
