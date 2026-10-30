import type { SystemSnapshot, VmProcessInfo } from "./schema.ts";
import { systemSnapshotSchema } from "./schema.ts";
import type { Collection } from "../collectors/index.ts";

export function buildSystemSnapshot(
  collection: Collection,
  windowSeconds: number,
  collectedAt = new Date().toISOString(),
): SystemSnapshot {
  const vmHost = collection.processes.find((process) =>
    process.command.includes("Virtualization.VirtualMachine") ||
    process.command.includes("com.docker.virtualization"),
  );
  const vmProcess = vmHost === undefined
    ? null
    : {
        pid: vmHost.pid,
        rssMb: vmHost.rssMb,
        cpuPercent: vmHost.intervalCpuPercent ?? 0,
        reservedMemoryMb: collection.docker.reservedMemoryMb,
        reservedCpus: collection.docker.reservedCpus,
        detectionMethod: dockerVmDetectionMethod(vmHost.command),
      };
  const candidate = {
    schemaVersion: "1.0",
    collectedAt,
    collectionWindowSeconds: windowSeconds,
    machine: collection.machine,
    memory: collection.memory,
    load: collection.load,
    processes: [...collection.processes],
    ports: [...collection.ports],
    docker: {
      ...collection.docker.state,
      vmProcess,
    },
    collectorStatus: [...collection.statuses],
  };
  return systemSnapshotSchema.parse(candidate);
}

function dockerVmDetectionMethod(command: string): VmProcessInfo["detectionMethod"] {
  return command.includes("Virtualization.VirtualMachine")
    ? "process_name"
    : "docker_virtualization";
}
