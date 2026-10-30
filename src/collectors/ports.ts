import type { CommandRunner, CollectorResult } from "./types.ts";
import { runCollector } from "./types.ts";
import { parsePortBindings } from "./parsers.ts";
import type { PortBinding } from "../snapshot/schema.ts";

export function createPortCollector(runner: CommandRunner) {
  return async (): Promise<CollectorResult<readonly PortBinding[]>> =>
    runCollector("ports", async () => {
      const startedAt = Date.now();
      const output = await runner(
        "lsof",
        ["-iTCP", "-sTCP:LISTEN", "-n", "-P"],
        { timeoutMs: 5000 },
      );
      const rows = parsePortBindings(output.stdout);
      if (output.exitCode === 0) {
        return {
          name: "ports",
          status: "complete",
          data: rows,
          error: null,
          durationMs: Date.now() - startedAt,
        };
      }
      const denied = /operation not permitted|permission denied/i.test(output.stderr);
      if (rows.length > 0) {
        return {
          name: "ports",
          status: "partial",
          data: rows,
          error: `lsof exited ${output.exitCode}; retained ${rows.length} rows`,
          durationMs: Date.now() - startedAt,
        };
      }
      if (denied) {
        return {
          name: "ports",
          status: "denied",
          data: [],
          error: output.stderr.trim(),
          durationMs: Date.now() - startedAt,
        };
      }
      if (output.exitCode !== 0 && output.stderr.trim() !== "") {
        throw new Error(`lsof failed: ${output.stderr.trim()}`);
      }
      return {
        name: "ports",
        status: "complete",
        data: [],
        error: denied ? output.stderr.trim() : null,
        durationMs: Date.now() - startedAt,
      };
    });
}
