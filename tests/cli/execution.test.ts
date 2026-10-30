import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostic } from "../../src/cli/pipeline.ts";
import { localReportSchema } from "../../src/reporter/local.ts";
import { writeSettings } from "../../src/config/settings.ts";
import { readTraceStore } from "../../src/trace/store.ts";
import { createFixtureRunner, fixture, output } from "../helpers.ts";
import type { CommandRunOptions, CommandRunner } from "../../src/collectors/types.ts";
import type { ValidatedCandidateSummary } from "../../src/validator/safety.ts";

async function executionTestRoot(): Promise<{ traceRoot: string; configRoot: string }> {
  return {
    traceRoot: await mkdtemp(join(tmpdir(), "otter-exec-trace-")),
    configRoot: await mkdtemp(join(tmpdir(), "otter-exec-config-")),
  };
}

describe("guarded clean execution", () => {
  test("local-only, JSON, scan, and denial never execute", async () => {
    const roots = await executionTestRoot();
    await writeSettings(roots.configRoot, { model: "gpt-4o-mini", enableExecution: true });
    const runner = await createFixtureRunner();
    const calls: string[] = [];
    const confirmation = {
      async confirm(candidate: ValidatedCandidateSummary) {
        calls.push(candidate.candidateId);
        return true;
      },
    };

    const localOnly = await runDiagnostic({
      command: "clean",
      json: true,
      localOnly: true,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: roots.traceRoot,
      configRoot: roots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation,
    });
    expect(localReportSchema.parse(JSON.parse(localOnly.stdout)).execution.status)
      .toBe("not_available");

    const json = await runDiagnostic({
      command: "clean",
      json: true,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: roots.traceRoot,
      configRoot: roots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation,
    });
    expect(JSON.parse(json.stdout).execution.status).toBe("not_available");

    const scan = await runDiagnostic({
      command: "scan",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: roots.traceRoot,
      configRoot: roots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation,
    });
    expect(scan.stdout).toContain("execution not_available");
    expect(calls).toEqual([]);
  });

  test("a denied candidate is audited and never sent to the executor", async () => {
    const roots = await executionTestRoot();
    await writeSettings(roots.configRoot, { model: "gpt-4o-mini", enableExecution: true });
    const result = await runDiagnostic({
      command: "clean",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: roots.traceRoot,
      configRoot: roots.configRoot,
      commandRunner: await createFixtureRunner(),
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation: { confirm: async () => false },
    });
    const events = await readTraceStore(roots.traceRoot).show(result.runId);
    const confirmed = events.find((event) => event.eventType === "user_confirmed");
    const completed = events.find((event) => event.eventType === "run_completed");
    expect(confirmed).toMatchObject({ payload: { approved: false } });
    const report = localReportSchema.parse(completed?.payload.report);
    expect(report.execution.results).toEqual([]);
    expect(events.some((event) => event.eventType === "action_executed")).toBe(false);
    expect(JSON.stringify(events).includes("project-cache")).toBe(false);
  });

  test("an approved disposable container is stopped, verified, and audited", async () => {
    const roots = await executionTestRoot();
    await writeSettings(roots.configRoot, { model: "gpt-4o-mini", enableExecution: true });
    const baseRunner = await createFixtureRunner();
    const runningInspection = await fixture("docker-inspect.json");
    const exitedInspection = runningInspection.replace('"running"', '"exited"');
    let stopped = false;
    const runner: CommandRunner = async (command, args, options: CommandRunOptions) => {
      if (command === "docker" && args[0] === "stop") {
        stopped = true;
        return output("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789\n");
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
      traceRoot: roots.traceRoot,
      configRoot: roots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation: { confirm: async () => true },
      revalidationWindowSeconds: 0.05,
    });
    expect(stopped).toBe(true);
    const events = await readTraceStore(roots.traceRoot).show(result.runId);
    const completed = events.find((event) => event.eventType === "run_completed");
    const report = localReportSchema.parse(completed?.payload.report);
    expect(report.execution.results[0]?.status).toBe("succeeded");
    expect(report.execution.verifications?.[0]?.status).toBe("verified");
    expect(events.filter((event) => event.eventType === "action_executed")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "action_verified")).toHaveLength(1);
    expect(result.stdout.includes("project-cache")).toBe(false);
  });

  test("execution stops when the confirmation audit write fails", async () => {
    const roots = await executionTestRoot();
    await writeSettings(roots.configRoot, { model: "gpt-4o-mini", enableExecution: true });
    let stopSeen = false;
    const runner: CommandRunner = async (command, args, options: CommandRunOptions) => {
      if (command === "docker" && args[0] === "stop") {
        stopSeen = true;
        return output("stopped\n");
      }
      return (await createFixtureRunner())(command, args, options);
    };
    const confirmation = {
      confirm: async () => {
        const files = (await readdir(roots.traceRoot)).filter((name) => name.endsWith(".jsonl"));
        const tracePath = join(roots.traceRoot, files[0] ?? "");
        await chmod(tracePath, 0o444);
        return true;
      },
    };

    await expect(runDiagnostic({
      command: "clean",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: roots.traceRoot,
      configRoot: roots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation,
      revalidationWindowSeconds: 0.05,
    })).rejects.toThrow();
    expect(stopSeen).toBe(false);
  });
});
