import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostic } from "../../src/cli/pipeline.ts";
import { writeSettings } from "../../src/config/settings.ts";
import { readTraceHistory, renderHistory } from "../../src/trace/history.ts";
import { createFixtureRunner, fixture, output } from "../helpers.ts";
import type { CommandRunner } from "../../src/collectors/types.ts";

describe("run history", () => {
  test("summarizes approvals, actions, verification, and failures without raw JSONL", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "otter-history-trace-"));
    const configRoot = await mkdtemp(join(tmpdir(), "otter-history-config-"));
    await writeSettings(configRoot, {
      model: "gpt-4o-mini",
      enableExecution: true,
      protectedExecutables: [],
    });
    const baseRunner = await createFixtureRunner();
    const runningInspection = await fixture("docker-inspect.json");
    const exitedInspection = runningInspection.replace('"running"', '"exited"');
    let stopped = false;
    const runner: CommandRunner = async (command, args, options) => {
      if (command === "docker" && args[0] === "stop") {
        stopped = true;
        return output("abcdef0123456789\n");
      }
      if (command === "docker" && args[0] === "inspect" && stopped) {
        return output(exitedInspection);
      }
      return baseRunner(command, args, options);
    };

    const result = await runDiagnostic({
      command: "clean",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot,
      configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation: { confirm: async () => true },
      revalidationWindowSeconds: 0.05,
    });
    expect(stopped).toBe(true);

    const summaries = await readTraceHistory(traceRoot);
    const rendered = renderHistory(summaries);
    expect(summaries[0]).toMatchObject({
      runId: result.runId,
      command: "clean",
      approvalCount: 1,
      stoppedCount: 1,
      failedCount: 0,
      executableCount: 1,
      blockedCount: 1,
    });
    expect(summaries[0]?.verificationSummary).toBe("1 verified, 0 active, 0 unknown");
    expect(rendered).toContain("1 approved, 1 stopped, 0 failed");
    expect(rendered).toContain("1 verified, 0 active, 0 unknown");
    expect(rendered).not.toContain("{");
    expect(rendered).not.toContain("jsonl");
  });
});
