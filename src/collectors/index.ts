import type { CommandRunner } from "./types.ts";
import { createMachineCollector } from "./system.ts";
import { createMemoryCollector } from "./memory.ts";
import { createProcessCollector } from "./process.ts";
import { createPortCollector } from "./ports.ts";
import { createDockerCollector, type DockerCollection } from "./docker.ts";
import type {
  CollectorStatus,
  LoadStats,
  MachineInfo,
  MemoryStats,
  PortBinding,
  ProcessInfo,
} from "../snapshot/schema.ts";

export interface Collection {
  readonly machine: MachineInfo;
  readonly load: LoadStats;
  readonly memory: MemoryStats;
  readonly processes: readonly ProcessInfo[];
  readonly ports: readonly PortBinding[];
  readonly docker: DockerCollection;
  readonly statuses: readonly CollectorStatus[];
}

export async function collectSystemSnapshot(
  runner: CommandRunner,
  windowSeconds: number,
): Promise<Collection> {
  const [machineResult, memoryResult, processResult, portResult, dockerResult] =
    await Promise.all([
      createMachineCollector(runner)(),
      createMemoryCollector(runner)(),
      createProcessCollector(runner, windowSeconds)(),
      createPortCollector(runner)(),
      createDockerCollector(runner, windowSeconds)(),
    ]);

  if (machineResult.data === null || memoryResult.data === null ||
      processResult.data === null || portResult.data === null ||
      dockerResult.data === null) {
    throw new Error("a required collector returned no data");
  }

  return {
    machine: machineResult.data.machine,
    load: machineResult.data.load,
    memory: memoryResult.data,
    processes: processResult.data,
    ports: portResult.data,
    docker: dockerResult.data,
    statuses: [machineResult, memoryResult, processResult, portResult, dockerResult].map(
      (result) => ({
        name: result.name,
        status: result.status,
        error: result.error,
        durationMs: result.durationMs,
      }),
    ),
  };
}
