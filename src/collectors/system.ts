import type {
  CommandOutput,
  CommandRunner,
  CollectorResult,
} from "./types.ts";
import { runCollector } from "./types.ts";
import {
  parseArch,
  parseBootTime,
  parseLoadAverage,
} from "./parsers.ts";
import type { LoadStats, MachineInfo } from "../snapshot/schema.ts";

export interface MachineCollection {
  readonly machine: MachineInfo;
  readonly load: LoadStats;
}

function required(output: CommandOutput, name: string): string {
  if (output.exitCode !== 0) {
    throw new Error(`${name} exited with code ${output.exitCode}`);
  }
  return output.stdout;
}

export function createMachineCollector(runner: CommandRunner) {
  return async (): Promise<CollectorResult<MachineCollection>> =>
    runCollector("machine", async () => {
      const startedAt = Date.now();
      const timeoutMs = 4000;
      const [arch, cores, memory, version, bootTime, load] = await Promise.all([
        runner("sysctl", ["-n", "hw.machine"], { timeoutMs }),
        runner("sysctl", ["-n", "hw.ncpu"], { timeoutMs }),
        runner("sysctl", ["-n", "hw.memsize"], { timeoutMs }),
        runner("sysctl", ["-n", "kern.osproductversion"], { timeoutMs }),
        runner("sysctl", ["-n", "kern.boottime"], { timeoutMs }),
        runner("sysctl", ["-n", "vm.loadavg"], { timeoutMs }),
      ]);

      const boot = parseBootTime(required(bootTime, "sysctl kern.boottime"));
      const loadValues = parseLoadAverage(required(load, "sysctl vm.loadavg"));
      const result: MachineCollection = {
        machine: {
          arch: parseArch(required(arch, "sysctl hw.machine")),
          cpuCores: Number.parseInt(required(cores, "sysctl hw.ncpu"), 10),
          totalMemoryGb:
            Number.parseInt(required(memory, "sysctl hw.memsize"), 10) /
            (1024 ** 3),
          macosVersion: required(version, "sysctl kern.osproductversion").trim(),
          bootTime: boot,
          uptimeHours: Math.max((Date.now() - Date.parse(boot)) / 3600000, 0),
        },
        load: {
          oneMinute: loadValues[0],
          fiveMinute: loadValues[1],
          fifteenMinute: loadValues[2],
        },
      };
      return {
        name: "machine",
        status: "complete",
        data: result,
        error: null,
        durationMs: Date.now() - startedAt,
      };
    });
}
