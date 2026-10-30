import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnosticOptionsFromCli } from "../../src/cli/options.ts";

const environment = { stdoutIsTty: true, traceRoot: "/t", configRoot: "/c" };

describe("CLI flag forwarding", () => {
  test("dry-run and verbose reach the pipeline options", () => {
    const options = diagnosticOptionsFromCli(
      "clean",
      { dryRun: true, verbose: true, window: 1 },
      environment,
    );
    expect(options.dryRun).toBe(true);
    expect(options.verbose).toBe(true);
    expect(options.windowSeconds).toBe(1);
  });

  test("absent flags are false and non-TTY output selects JSON", () => {
    const options = diagnosticOptionsFromCli(
      "scan",
      { window: 3 },
      { ...environment, stdoutIsTty: false },
    );
    expect(options.dryRun).toBe(false);
    expect(options.verbose).toBe(false);
    expect(options.json).toBe(true);
  });

  test("the compiled command line rejects --dry-run with --send-llm before any collection", async () => {
    const home = await mkdtemp(join(tmpdir(), "otter-dry-home-"));
    const result = Bun.spawnSync(["bun", "src/index.ts", "clean", "--dry-run", "--send-llm"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home, OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("--dry-run does not send an analyzer request");
  });
});
