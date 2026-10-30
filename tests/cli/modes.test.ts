import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
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
