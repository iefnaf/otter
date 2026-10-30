import type { CandidateFact } from "../redactor/schema.ts";

export interface ProcessCandidate {
  readonly candidateId: string;
  readonly kind: "process";
  readonly entityId: string;
  readonly pid: number;
  readonly startTime: string;
  readonly command: string;
  readonly user: string;
  readonly executable: string;
  readonly intervalCpuPercent: number | null;
  readonly rssMb: number;
  readonly elapsedHours: number;
  readonly hasControllingTerminal: boolean;
  readonly listeningPorts: readonly number[];
}

export interface ContainerCandidate {
  readonly candidateId: string;
  readonly kind: "container";
  readonly entityId: string;
  readonly containerId: string;
  readonly startedAt: string;
  readonly name: string;
  readonly state: "running" | "paused" | "exited" | "restarting";
  readonly health: "healthy" | "unhealthy" | "starting" | "none";
  readonly restartPolicy: "no" | "always" | "unless-stopped" | "on-failure";
  readonly intervalCpuPercent: number | null;
  readonly memoryUsageMb: number;
}

export type LocalCandidate = ProcessCandidate | ContainerCandidate;

export interface CandidateBook {
  readonly records: readonly LocalCandidate[];
  readonly facts: readonly CandidateFact[];
}
