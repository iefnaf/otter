import { z } from "zod";
import { collectorStatuses } from "../collectors/types.ts";

export const machineSchema = z.object({
  arch: z.enum(["arm64", "x86_64"]),
  cpuCores: z.number().int().positive(),
  totalMemoryGb: z.number().positive(),
  macosVersion: z.string().min(1),
  bootTime: z.string().min(1),
  uptimeHours: z.number().nonnegative(),
});

export const memorySchema = z.object({
  freeMb: z.number().nonnegative(),
  activeMb: z.number().nonnegative(),
  inactiveMb: z.number().nonnegative(),
  compressedMb: z.number().nonnegative(),
  wiredMb: z.number().nonnegative(),
  swapTotalMb: z.number().nonnegative(),
  swapUsedMb: z.number().nonnegative(),
  pageSizeBytes: z.number().int().positive(),
});

export const loadSchema = z.object({
  oneMinute: z.number().nonnegative(),
  fiveMinute: z.number().nonnegative(),
  fifteenMinute: z.number().nonnegative(),
});

export const processSchema = z.object({
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative(),
  pgid: z.number().int().positive(),
  user: z.string().min(1),
  state: z.string().min(1),
  controllingTerminal: z.string(),
  lifetimeCpuPercent: z.number().nonnegative(),
  memoryPercent: z.number().nonnegative(),
  rssMb: z.number().nonnegative(),
  vszMb: z.number().nonnegative(),
  startTime: z.string().min(1),
  elapsed: z.string().min(1),
  cpuTime: z.string().min(1),
  intervalCpuPercent: z.number().nonnegative().nullable(),
  command: z.string().min(1),
  entityId: z.string().regex(/^proc_[0-9a-f-]{36}$/),
});

export const portSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal("tcp"),
  processName: z.string().min(1),
  address: z.string().min(1),
});

export const vmProcessSchema = z.object({
  pid: z.number().int().positive(),
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
});

export const containerSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  state: z.enum(["running", "paused", "exited", "restarting"]),
  health: z.enum(["healthy", "unhealthy", "starting", "none"]),
  restartPolicy: z.enum(["no", "always", "unless-stopped", "on-failure"]),
  intervalCpuPercent: z.number().nonnegative().nullable(),
  memoryUsageMb: z.number().nonnegative(),
  entityId: z.string().regex(/^container_[0-9a-f-]{36}$/),
  labels: z.record(z.string()),
});

export const collectorStatusSchema = z.object({
  name: z.string().min(1),
  status: z.enum(collectorStatuses),
  error: z.string().nullable(),
  durationMs: z.number().nonnegative(),
});

export const dockerStateSchema = z.object({
  daemonAvailable: z.boolean(),
  daemonVersion: z.string().nullable(),
  vmProcess: vmProcessSchema.nullable(),
  containers: z.array(containerSchema),
});

export const systemSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  collectedAt: z.string().min(1),
  collectionWindowSeconds: z.number().nonnegative(),
  machine: machineSchema,
  memory: memorySchema,
  load: loadSchema,
  processes: z.array(processSchema),
  ports: z.array(portSchema),
  docker: dockerStateSchema,
  collectorStatus: z.array(collectorStatusSchema),
});

export type MachineInfo = z.infer<typeof machineSchema>;
export type MemoryStats = z.infer<typeof memorySchema>;
export type LoadStats = z.infer<typeof loadSchema>;
export type ProcessInfo = z.infer<typeof processSchema>;
export type PortBinding = z.infer<typeof portSchema>;
export type VmProcessInfo = z.infer<typeof vmProcessSchema>;
export type ContainerInfo = z.infer<typeof containerSchema>;
export type DockerState = z.infer<typeof dockerStateSchema>;
export type CollectorStatus = z.infer<typeof collectorStatusSchema>;
export type SystemSnapshot = z.infer<typeof systemSnapshotSchema>;
