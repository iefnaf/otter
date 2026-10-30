import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnostic } from "../../src/cli/pipeline.ts";
import { localReportSchema, sanitizeTerminalText } from "../../src/reporter/local.ts";
import { redactedPayloadSchema } from "../../src/redactor/schema.ts";
import { createFixtureRunner } from "../helpers.ts";

describe("CLI local modes", () => {
  test("default mode stays local and preview prints only the redacted payload", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "otter-cli-"));
    const configRoot = await mkdtemp(join(tmpdir(), "otter-config-"));
    const runner = await createFixtureRunner();
    const local = await runDiagnostic({
      command: "scan",
      json: true,
      localOnly: false,
      previewPayload: false,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot,
      configRoot,
      commandRunner: runner,
    });
    expect(local.exitCode).toBe(0);
    const report = localReportSchema.parse(JSON.parse(local.stdout));
    expect(report.execution.enabled).toBe(false);
    expect(local.stdout.includes("--token")).toBe(false);

    const previewRoot = await mkdtemp(join(tmpdir(), "otter-preview-"));
    const preview = await runDiagnostic({
      command: "explain",
      json: true,
      localOnly: false,
      previewPayload: true,
      sendLlm: false,
      windowSeconds: 0,
      traceRoot: previewRoot,
      configRoot,
      commandRunner: runner,
    });
    const payload = redactedPayloadSchema.parse(JSON.parse(preview.stdout));
    expect(payload.processTiers.detail.every((process) => !("command" in process))).toBe(true);
  });

  test("the command surface has no consent-skipping execution flag", () => {
    const result = Bun.spawnSync(["bun", "src/index.ts", "--help"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const help = result.stdout.toString();
    expect(help).toContain("scan");
    expect(help).not.toContain("--yes");
    expect(help).not.toContain("--trace-root");
  });

  test("the clean command exposes dry-run and verbose report modes", () => {
    const result = Bun.spawnSync(["bun", "src/index.ts", "clean", "--help"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const help = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(help).toContain("--dry-run");
    expect(help).toContain("--verbose");
    expect(help).not.toContain("--yes");
  });

  test("protection commands persist user executable rules in a private config", async () => {
    const home = await mkdtemp(join(tmpdir(), "otter-protect-home-"));
    const env = { ...process.env, HOME: home };
    const run = (args: string[]) => Bun.spawnSync(["bun", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    expect(run(["protect", "add", "My Agent"]).stdout.toString()).toContain("Protected my agent.");
    const list = run(["protect", "list"]).stdout.toString();
    expect(list).toContain("clash");
    expect(list).toContain("tailscale");
    expect(list).toContain("my agent");
    expect(run(["protect", "remove", "MY AGENT"]).stdout.toString())
      .toContain("Removed protection for my agent.");

    const settings = JSON.parse(await readFile(join(home, ".otter", "settings.json"), "utf8"));
    expect(settings.protectedExecutables).toEqual([]);
  });

  test("history prints a human-readable table", async () => {
    const home = await mkdtemp(join(tmpdir(), "otter-history-home-"));
    const result = Bun.spawnSync(["bun", "src/index.ts", "history"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("run                   command   result");
  });

  test("non-TTY output defaults to JSON", () => {
    const result = Bun.spawnSync(["bun", "src/index.ts", "scan", "--local-only", "--window", "0"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(() => localReportSchema.parse(JSON.parse(result.stdout.toString()))).not.toThrow();
  });

  test("terminal rendering removes model and process control characters", () => {
    expect(sanitizeTerminalText("safe\u001b]52;c;oops\nnext")).toBe("safe]52;c;oops\nnext");
  });
});
