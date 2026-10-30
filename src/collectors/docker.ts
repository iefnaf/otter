import { randomUUID } from "node:crypto";
import type { CommandRunner, CollectorResult } from "./types.ts";
import { runCollector } from "./types.ts";
import {
  parseDockerContainers,
  parseDockerInfo,
  parseDockerInspection,
  parseDockerStats,
} from "./parsers.ts";
import type { ContainerInfo, DockerState } from "../snapshot/schema.ts";

export interface DockerCollection {
  readonly state: DockerState;
  readonly reservedCpus: number | null;
  readonly reservedMemoryMb: number | null;
}

export function createDockerCollector(
  runner: CommandRunner,
  windowSeconds: number,
) {
  return async (): Promise<CollectorResult<DockerCollection>> =>
    runCollector("docker", async () => {
      const startedAt = Date.now();
      const timeoutMs = Math.min((windowSeconds + 8) * 1000, 15_000);
      const infoOutput = await runner(
        "docker",
        ["info", "--format", "{{json .}}"],
        { timeoutMs },
      );
      if (infoOutput.exitCode !== 0) {
        const data: DockerCollection = {
          reservedCpus: null,
          reservedMemoryMb: null,
          state: {
            daemonAvailable: false,
            daemonVersion: null,
            vmProcess: null,
            containers: [],
          },
        };
        return {
          name: "docker",
          status: "skipped",
          data,
          error: "Docker daemon is unavailable",
          durationMs: Date.now() - startedAt,
        };
      }

      const info = parseDockerInfo(infoOutput.stdout);
      const psOutput = await runner("docker", ["ps", "--no-trunc", "--format", "json"], { timeoutMs });
      if (psOutput.exitCode !== 0) throw new Error("docker ps failed");
      const records = parseDockerContainers(psOutput.stdout);
      const firstStatsOutput = await runner(
        "docker",
        ["stats", "--no-stream", "--format", "json"],
        { timeoutMs },
      );
      if (firstStatsOutput.exitCode !== 0) throw new Error("first docker stats failed");
      const firstStats = parseDockerStats(firstStatsOutput.stdout);
      await new Promise((resolve) => setTimeout(resolve, windowSeconds * 1000));
      const secondStatsOutput = await runner(
        "docker",
        ["stats", "--no-stream", "--format", "json"],
        { timeoutMs },
      );
      if (secondStatsOutput.exitCode !== 0) throw new Error("second docker stats failed");
      const secondStats = parseDockerStats(secondStatsOutput.stdout);
      const inspections = await Promise.all(records.map(async (record) => {
        const inspectOutput = await runner(
          "docker",
          ["inspect", "--format", "{{json .}}", record.id],
          { timeoutMs },
        );
        if (inspectOutput.exitCode !== 0) throw new Error(`docker inspect failed for ${record.id}`);
        return { record, inspection: parseDockerInspection(inspectOutput.stdout) };
      }));
      const containers: ContainerInfo[] = inspections.map(({ record, inspection }) => {
        const first = firstStats.find((sample) => record.id.startsWith(sample.id));
        const second = secondStats.find((sample) => record.id.startsWith(sample.id));
        const firstCpu = first?.cpuPercent ?? null;
        const secondCpu = second?.cpuPercent ?? null;
        return {
          id: record.id,
          startedAt: inspection.startedAt,
          name: inspection.name,
          image: inspection.image,
          state: inspection.state,
          health: inspection.health,
          restartPolicy: inspection.restartPolicy,
          intervalCpuPercent: firstCpu !== null && secondCpu !== null
            ? (firstCpu + secondCpu) / 2
            : null,
          memoryUsageMb: second?.memoryUsageMb ?? first?.memoryUsageMb ?? 0,
          entityId: `container_${randomUUID()}`,
          labels: inspection.labels,
        };
      });

      return {
        name: "docker",
        status: "complete",
        data: {
          reservedCpus: info.reservedCpus,
          reservedMemoryMb: info.reservedMemoryMb,
          state: {
            daemonAvailable: true,
            daemonVersion: info.serverVersion,
            vmProcess: null,
            containers,
          },
        },
        error: null,
        durationMs: Date.now() - startedAt,
      };
    });
}
