import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostic } from "../../src/cli/pipeline.ts";
import { writeSettings } from "../../src/config/settings.ts";
import { readTraceStore } from "../../src/trace/store.ts";
import { createFixtureRunner, fixture, output } from "../helpers.ts";
import type { CommandRunner } from "../../src/collectors/types.ts";

async function roots(name: string): Promise<{ traceRoot: string; configRoot: string }> {
  return {
    traceRoot: await mkdtemp(join(tmpdir(), `${name}-trace-`)),
    configRoot: await mkdtemp(join(tmpdir(), `${name}-config-`)),
  };
}

describe("clean dry run", () => {
  test("collects full details without confirmation or execution and matches review exit code", async () => {
    const dryRoots = await roots("otter-dry");
    const reviewRoots = await roots("otter-review");
    await writeSettings(dryRoots.configRoot, {
      model: "gpt-4o-mini",
      enableExecution: true,
      protectedExecutables: [],
    });
    await writeSettings(reviewRoots.configRoot, {
      model: "gpt-4o-mini",
      enableExecution: true,
      protectedExecutables: [],
    });
    const runner = await createFixtureRunner();
    const confirmedTargets: string[] = [];

    const dryRun = await runDiagnostic({
      command: "clean",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      dryRun: true,
      windowSeconds: 0,
      traceRoot: dryRoots.traceRoot,
      configRoot: dryRoots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation: {
        confirm: async (candidate) => {
          confirmedTargets.push(candidate.target.kind === "process"
            ? candidate.target.executable
            : candidate.target.name);
          return true;
        },
      },
    });
    const review = await runDiagnostic({
      command: "clean",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: reviewRoots.traceRoot,
      configRoot: reviewRoots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation: { confirm: async () => false },
    });

    expect(confirmedTargets).toEqual([]);
    expect(dryRun.exitCode).toBe(review.exitCode);
    expect(dryRun.stdout.split("\n").length).toBeLessThan(50);
    const events = await readTraceStore(dryRoots.traceRoot).show(dryRun.runId);
    expect(events.some((event) => event.eventType === "user_confirmed")).toBe(false);
    expect(events.some((event) => event.eventType === "action_executed")).toBe(false);
    expect(events.some((event) => event.eventType === "action_verified")).toBe(false);
    const completed = events.find((event) => event.eventType === "run_completed");
    expect(completed?.eventType === "run_completed" && "validatedCandidates" in completed.payload.report)
      .toBe(true);
  });

  test("a persisted executable rule cannot reach the confirmation prompt", async () => {
    const testRoots = await roots("otter-protected");
    await writeSettings(testRoots.configRoot, {
      model: "gpt-4o-mini",
      enableExecution: true,
      protectedExecutables: ["node"],
    });
    const confirmedTargets: string[] = [];
    const baseRunner = await createFixtureRunner();
    const processList = (await fixture("ps-second.txt"))
      .split("\n")
      .map((line) => line.includes("/usr/bin/git status")
        ? "  900     1   900 fanfei     R    ??  0.0  0.5   524288    2097152 Wed Oct 29 09:03:00 2025   10:00:00  00:00.20 /Users/fanfei/project/bin/node"
        : line)
      .join("\n");
    const portList = (await fixture("lsof.txt"))
      .replace("node     750", "node     900");
    const runner: CommandRunner = async (_command, args, options) =>
      args.join(" ") === "-eo pid,ppid,pgid,user,stat,tt,%cpu,%mem,rss,vsz,lstart,etime,cputime,command"
        ? output(processList)
        : args.join(" ") === "-iTCP -sTCP:LISTEN -n -P"
          ? output(portList)
        : baseRunner(_command, args, options);
    const result = await runDiagnostic({
      command: "clean",
      json: false,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: testRoots.traceRoot,
      configRoot: testRoots.configRoot,
      commandRunner: runner,
      currentUser: "fanfei",
      isInteractive: () => true,
      confirmation: {
        confirm: async (candidate) => {
          confirmedTargets.push(candidate.target.kind === "process"
            ? candidate.target.executable
            : candidate.target.name);
          return false;
        },
      },
    });
    const events = await readTraceStore(testRoots.traceRoot).show(result.runId);
    const completed = events.find((event) => event.eventType === "run_completed");
    const candidates = completed?.eventType === "run_completed" &&
      "validatedCandidates" in completed.payload.report
      ? completed.payload.report.validatedCandidates
      : [];
    const node = candidates.find((candidate) => "target" in candidate && candidate.target.kind === "process" && candidate.target.executable === "node");

    expect(node).toMatchObject({ decision: "protected", eligibility: "protected" });
    expect(confirmedTargets).toEqual(["project-cache"]);
  });
});
