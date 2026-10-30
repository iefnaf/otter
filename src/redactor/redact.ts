import { createHash } from "node:crypto";
import { basename } from "node:path";
import type {
  ContainerInfo,
  ProcessInfo,
  SystemSnapshot,
} from "../snapshot/schema.ts";
import type {
  ProcessSummary,
  RedactedContainer,
  RedactedPort,
  RedactedPayload,
  RedactedProcess,
  RedactionResult,
} from "./schema.ts";
import { parseElapsedSeconds } from "../collectors/parsers.ts";
import { buildCandidateBook } from "../candidates/build.ts";

const genericNames = new Set([
  "redis",
  "mysql",
  "postgres",
  "mongo",
  "nginx",
  "node",
  "python",
  "alpine",
  "busybox",
  "ubuntu",
  "debian",
]);

export interface RedactionOptions {
  readonly runId: string;
  readonly currentUser: string;
}

export class RedactionCounter {
  private credentials = 0;
  private paths = 0;
  private identifiers = 0;

  path(): void {
    this.paths += 1;
  }

  identifier(): void {
    this.identifiers += 1;
  }

  result(): { credentials: number; paths: number; identifiers: number } {
    return { credentials: this.credentials, paths: this.paths, identifiers: this.identifiers };
  }
}

function hash(value: string, runId: string): string {
  return createHash("sha256").update(`${runId}:${value}`).digest("hex").slice(0, 12);
}

export function executableName(command: string): string {
  const firstArgument = command.trim().split(/\s+/)[0] ?? "";
  return basename(firstArgument) || "unknown";
}

function addressKind(address: string): RedactedPort["addressKind"] {
  if (address === "*" || address === "0.0.0.0" || address === "::") return "wildcard";
  if (address === "127.0.0.1" || address === "::1") return "loopback";
  if (/^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)) {
    return "private";
  }
  return "public";
}

function redactProcess(process: ProcessInfo): RedactedProcess {
  return {
    entityId: process.entityId,
    pid: process.pid,
    ppid: process.ppid,
    executable: executableName(process.command),
    state: process.state,
    controllingTerminal: process.controllingTerminal === "??" ? "none" : "present",
    lifetimeCpuPercent: process.lifetimeCpuPercent,
    intervalCpuPercent: process.intervalCpuPercent,
    memoryPercent: process.memoryPercent,
    rssMb: process.rssMb,
    vszMb: process.vszMb,
    startTime: process.startTime,
    elapsedSeconds: parseElapsedSeconds(process.elapsed),
  };
}

function summarize(processes: readonly ProcessInfo[]): readonly ProcessSummary[] {
  const groups = new Map<string, ProcessInfo[]>();
  for (const process of processes) {
    const executable = executableName(process.command);
    const existing = groups.get(executable) ?? [];
    existing.push(process);
    groups.set(executable, existing);
  }
  return [...groups.entries()].map(([executable, group]): ProcessSummary => {
    const intervals = group
      .map((process) => process.intervalCpuPercent)
      .filter((value): value is number => value !== null);
    return {
      executable,
      count: group.length,
      totalRssMb: group.reduce((total, process) => total + process.rssMb, 0),
      averageIntervalCpuPercent:
        intervals.length === 0
          ? null
          : intervals.reduce((total, value) => total + value, 0) / intervals.length,
    };
  });
}

function topProcesses(processes: readonly ProcessInfo[]): readonly ProcessInfo[] {
  const byCpu = [...processes]
    .sort((left, right) => (right.intervalCpuPercent ?? 0) - (left.intervalCpuPercent ?? 0))
    .slice(0, 25);
  const byMemory = [...processes]
    .sort((left, right) => right.rssMb - left.rssMb)
    .slice(0, 25);
  return [...new Map([...byCpu, ...byMemory].map((process) => [process.entityId, process])).values()];
}

function redactContainer(
  container: ContainerInfo,
  runId: string,
  counter: RedactionCounter,
): RedactedContainer {
  const name = genericNames.has(container.name) ? container.name : hash(container.name, runId);
  const image = genericNames.has(container.image) ? container.image : hash(container.image, runId);
  if (name !== container.name || image !== container.image) counter.identifier();
  return {
    entityId: container.entityId,
    name,
    image,
    state: container.state,
    health: container.health,
    restartPolicy: container.restartPolicy,
    intervalCpuPercent: container.intervalCpuPercent,
    memoryUsageMb: container.memoryUsageMb,
  };
}

export function redactSnapshot(
  snapshot: SystemSnapshot,
  options: RedactionOptions,
): RedactionResult {
  const counter = new RedactionCounter();
  const candidateBook = buildCandidateBook(snapshot, options.currentUser, options.runId);
  const candidateEntityIds = new Set(
    candidateBook.records
      .filter((candidate) => candidate.kind === "process")
      .map((candidate) => candidate.entityId),
  );
  const detail = topProcesses(snapshot.processes);
  const detailIds = new Set(detail.map((process) => process.entityId));
  const candidates = snapshot.processes
    .filter((process) => candidateEntityIds.has(process.entityId))
    .sort((left, right) => right.rssMb - left.rssMb);
  const representedIds = new Set([
    ...detailIds,
    ...candidates.map((process) => process.entityId),
  ]);
  const summarySource = snapshot.processes.filter((process) => !representedIds.has(process.entityId));
  const ports: RedactedPort[] = snapshot.ports.map((port) => ({
    pid: port.pid,
    port: port.port,
    protocol: port.protocol,
    addressKind: addressKind(port.address),
  }));
  const containers = snapshot.docker.containers.map((container) =>
    redactContainer(container, options.runId, counter),
  );
  const payload: RedactedPayload = {
    schemaVersion: "1.0-redacted",
    runId: options.runId,
    machine: snapshot.machine,
    memory: snapshot.memory,
    load: snapshot.load,
    collectorStatus: snapshot.collectorStatus,
    ports,
    docker: {
      daemonAvailable: snapshot.docker.daemonAvailable,
      daemonVersion: snapshot.docker.daemonVersion,
      vmProcess: snapshot.docker.vmProcess === null
        ? null
        : {
            rssMb: snapshot.docker.vmProcess.rssMb,
            cpuPercent: snapshot.docker.vmProcess.cpuPercent,
            reservedMemoryMb: snapshot.docker.vmProcess.reservedMemoryMb,
            reservedCpus: snapshot.docker.vmProcess.reservedCpus,
            detectionMethod: snapshot.docker.vmProcess.detectionMethod,
          },
      containers,
    },
    processTiers: {
      detail: detail.map(redactProcess),
      candidates: candidates.map(redactProcess),
      summary: [...summarize(summarySource)],
    },
    candidateBook: [...candidateBook.facts],
  };
  return { payload, transformations: counter.result(), candidateBook };
}
