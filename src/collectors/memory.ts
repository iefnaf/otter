import type { CommandRunner, CollectorResult } from "./types.ts";
import { runCollector } from "./types.ts";
import { parseMemoryStatistics } from "./parsers.ts";
import type { MemoryStats } from "../snapshot/schema.ts";

export function createMemoryCollector(runner: CommandRunner) {
  return async (): Promise<CollectorResult<MemoryStats>> =>
    runCollector("memory", async () => {
      const startedAt = Date.now();
      const timeoutMs = 4000;
      const [vmStat, swap] = await Promise.all([
        runner("vm_stat", [], { timeoutMs }),
        runner("sysctl", ["-n", "vm.swapusage"], { timeoutMs }),
      ]);
      if (vmStat.exitCode !== 0 || swap.exitCode !== 0) {
        throw new Error("memory commands failed");
      }
      return {
        name: "memory",
        status: "complete",
        data: parseMemoryStatistics(vmStat.stdout, swap.stdout),
        error: null,
        durationMs: Date.now() - startedAt,
      };
    });
}
