import { z } from "zod";
import {
  collectorStatusSchema,
  loadSchema,
  machineSchema,
  memorySchema,
} from "../snapshot/schema.ts";
import type { CandidateBook } from "../candidates/types.ts";

export const redactedProcessSchema = z.object({
  entityId: z.string().min(1),
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative(),
  executable: z.string().min(1),
  state: z.string().min(1),
  controllingTerminal: z.string(),
  lifetimeCpuPercent: z.number().nonnegative(),
  intervalCpuPercent: z.number().nonnegative().nullable(),
  memoryPercent: z.number().nonnegative(),
  rssMb: z.number().nonnegative(),
  vszMb: z.number().nonnegative(),
  startTime: z.string().min(1),
  elapsedSeconds: z.number().nonnegative(),
});

export const processSummarySchema = z.object({
  executable: z.string().min(1),
  count: z.number().int().positive(),
  totalRssMb: z.number().nonnegative(),
  averageIntervalCpuPercent: z.number().nonnegative().nullable(),
});

export const redactedPortSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal("tcp"),
  addressKind: z.enum(["loopback", "wildcard", "private", "public"]),
});

export const redactedContainerSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  state: z.enum(["running", "paused", "exited", "restarting"]),
  health: z.enum(["healthy", "unhealthy", "starting", "none"]),
  restartPolicy: z.enum(["no", "always", "unless-stopped", "on-failure"]),
  intervalCpuPercent: z.number().nonnegative().nullable(),
  memoryUsageMb: z.number().nonnegative(),
});

export const candidateFactSchema = z.discriminatedUnion("kind", [
  z.object({
    candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
    kind: z.literal("process"),
    executable: z.string().min(1),
    intervalCpuPercent: z.number().nonnegative().nullable(),
    rssMb: z.number().nonnegative(),
    elapsedHours: z.number().nonnegative(),
    hasControllingTerminal: z.boolean(),
    listeningPorts: z.array(z.number().int().min(1).max(65535)),
  }),
  z.object({
    candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
    kind: z.literal("container"),
    state: z.enum(["running", "paused", "exited", "restarting"]),
    health: z.enum(["healthy", "unhealthy", "starting", "none"]),
    restartPolicy: z.enum(["no", "always", "unless-stopped", "on-failure"]),
    intervalCpuPercent: z.number().nonnegative().nullable(),
    memoryUsageMb: z.number().nonnegative(),
    disposable: z.boolean(),
  }),
]);

export const redactedPayloadSchema = z.object({
  schemaVersion: z.literal("1.0-redacted"),
  runId: z.string().min(1),
  machine: machineSchema,
  memory: memorySchema,
  load: loadSchema,
  collectorStatus: z.array(collectorStatusSchema),
  ports: z.array(redactedPortSchema),
  docker: z.object({
    daemonAvailable: z.boolean(),
    daemonVersion: z.string().nullable(),
    vmProcess: z
      .object({
        rssMb: z.number().nonnegative(),
        cpuPercent: z.number().nonnegative(),
        reservedMemoryMb: z.number().positive().nullable(),
        reservedCpus: z.number().positive().nullable(),
        detectionMethod: z.enum([
          "process_name",
          "docker_info",
          "docker_virtualization",
          "unknown",
        ]),
      })
      .nullable(),
    containers: z.array(redactedContainerSchema),
  }),
  processTiers: z.object({
    detail: z.array(redactedProcessSchema),
    candidates: z.array(redactedProcessSchema),
    summary: z.array(processSummarySchema),
  }),
  candidateBook: z.array(candidateFactSchema),
});

export type RedactedProcess = z.infer<typeof redactedProcessSchema>;
export type ProcessSummary = z.infer<typeof processSummarySchema>;
export type RedactedPort = z.infer<typeof redactedPortSchema>;
export type RedactedContainer = z.infer<typeof redactedContainerSchema>;
export type CandidateFact = z.infer<typeof candidateFactSchema>;
export type RedactedPayload = z.infer<typeof redactedPayloadSchema>;

export interface TransformationCounts {
  readonly credentials: number;
  readonly paths: number;
  readonly identifiers: number;
}

export interface RedactionResult {
  readonly payload: RedactedPayload;
  readonly transformations: TransformationCounts;
  readonly candidateBook: CandidateBook;
}
