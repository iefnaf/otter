import { randomUUID } from "node:crypto";
import type { CommandRunner, CollectorResult } from "./types.ts";
import { runCollector } from "./types.ts";
import {
  calculateIntervalCpuForPid,
  parseCpuTime,
  parseProcessSample,
} from "./parsers.ts";
import type { ProcessInfo } from "../snapshot/schema.ts";

export function createProcessCollector(
  runner: CommandRunner,
  windowSeconds: number,
) {
  return async (): Promise<CollectorResult<readonly ProcessInfo[]>> =>
    runCollector("process", async () => {
      const startedAt = Date.now();
      const args = [
        "-eo",
        "pid,ppid,pgid,user,stat,tt,%cpu,%mem,rss,vsz,lstart,etime,cputime,command",
      ];
      const firstOutput = await runner("ps", args, {
        timeoutMs: (windowSeconds + 5) * 1000,
      });
      if (firstOutput.exitCode !== 0) throw new Error("ps failed");
      const first = parseProcessSample(firstOutput.stdout, Date.now());
      await new Promise((resolve) => setTimeout(resolve, windowSeconds * 1000));
      const secondOutput = await runner("ps", args, {
        timeoutMs: (windowSeconds + 5) * 1000,
      });
      if (secondOutput.exitCode !== 0) throw new Error("second ps failed");
      const second = parseProcessSample(secondOutput.stdout, Date.now());
      const firstByPid = new Map(first.rows.map((row) => [row.pid, row]));
      const processes = second.rows.map((row): ProcessInfo => {
        const earlier = firstByPid.get(row.pid);
        const interval =
          earlier === undefined
            ? null
            : calculateIntervalCpuForPid(first, second, row.pid);
        return {
          ...row,
          intervalCpuPercent: interval,
          entityId: `proc_${randomUUID()}`,
        };
      });
      return {
        name: "process",
        status: "complete",
        data: processes,
        error: null,
        durationMs: Date.now() - startedAt,
      };
    });
}

export { parseCpuTime };
