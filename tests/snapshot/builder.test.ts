import { describe, expect, test } from "bun:test";
import { buildSystemSnapshot } from "../../src/snapshot/builder.ts";
import { snapshotFixture } from "../helpers.ts";
import type { Collection } from "../../src/collectors/index.ts";

describe("snapshot builder", () => {
  test("combines collector data and validates the versioned boundary", () => {
    const source = snapshotFixture();
    const dockerHost = { ...source.processes[0]!, command: "Virtualization.VirtualMachine" };
    const collection: Collection = {
      machine: source.machine,
      load: source.load,
      memory: source.memory,
      processes: [...source.processes.slice(1), dockerHost],
      ports: source.ports,
      docker: {
        state: { ...source.docker, vmProcess: null },
        reservedCpus: 4,
        reservedMemoryMb: 8192,
      },
      statuses: source.collectorStatus,
    };
    const snapshot = buildSystemSnapshot(collection, 3, "2026-10-30T01:02:03.000Z");
    expect(snapshot.schemaVersion).toBe("1.0");
    expect(snapshot.collectionWindowSeconds).toBe(3);
    expect(snapshot.docker.vmProcess?.detectionMethod).toBe("process_name");
    expect(snapshot.docker.vmProcess?.reservedCpus).toBe(4);
  });
});
