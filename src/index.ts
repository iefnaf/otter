#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "commander";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runDiagnostic } from "./cli/pipeline.ts";
import { localCommandRunner } from "./collectors/runner.ts";
import { clearApiKey, getApiKey, setApiKey } from "./config/keychain.ts";
import { readSettings } from "./config/settings.ts";
import { readTraceStore } from "./trace/store.ts";

const otterRoot = join(homedir(), ".otter");

function parseWindow(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    throw new InvalidArgumentError("must be an integer from 0 through 10");
  }
  return parsed;
}

async function defaultTraceRoot(): Promise<string> {
  const root = join(otterRoot, "traces");
  await mkdir(root, { recursive: true });
  return root;
}

const program = new Command()
  .name("otter")
  .version("0.1.0")
  .description("Read-only macOS resource diagnostics");

function addDiagnosticOptions(command: Command): Command {
  return command
    .option("--json", "write JSON to stdout")
    .option("--local-only", "stay local; this is the default in v0.1")
    .option("--preview-payload", "print the exact outbound-shaped redacted payload and exit")
    .option("--send-llm", "explicitly send the redacted payload to the configured analyzer")
    .option("--window <seconds>", "process sampling window", parseWindow, 3)
    .option("--trace-root <path>", "trace directory, primarily for tests");
}

async function executeDiagnostic(
  command: "scan" | "explain" | "clean",
  options: {
    json?: boolean;
    localOnly?: boolean;
    previewPayload?: boolean;
    sendLlm?: boolean;
    window: number;
    traceRoot?: string;
  },
): Promise<void> {
  const result = await runDiagnostic({
    command,
    json: options.json === true,
    localOnly: options.localOnly === true,
    previewPayload: options.previewPayload === true,
    sendLlm: options.sendLlm === true,
    windowSeconds: options.window,
    traceRoot: options.traceRoot ?? (await defaultTraceRoot()),
    configRoot: otterRoot,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

addDiagnosticOptions(program.command("scan").description("collect a local snapshot"))
  .action(async (options) => executeDiagnostic("scan", options));

addDiagnosticOptions(program.command("explain").description("explain resource usage without execution"))
  .action(async (options) => executeDiagnostic("explain", options));

addDiagnosticOptions(program.command("clean").description("show candidates; execution is disabled"))
  .action(async (options) => executeDiagnostic("clean", options));

const config = program.command("config").description("manage local configuration");

config.command("show")
  .description("show non-secret settings")
  .action(async () => {
    const settings = await readSettings(otterRoot);
    const apiKeyConfigured = await getApiKey(localCommandRunner) !== null;
    process.stdout.write(`${JSON.stringify({ ...settings, apiKeyConfigured }, null, 2)}\n`);
  });

config.command("set-api-key")
  .description("store an OpenAI-compatible API key in macOS Keychain")
  .action(async () => {
    process.stdout.write("API key: ");
    const chunks: string[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk.toString());
    const apiKey = chunks.join("").trim();
    if (apiKey === "") throw new Error("API key was empty");
    await setApiKey(localCommandRunner, apiKey);
    process.stdout.write("API key stored in macOS Keychain.\n");
  });

config.command("clear-api-key")
  .description("remove the Otter API key from macOS Keychain")
  .action(async () => {
    const deleted = await clearApiKey(localCommandRunner);
    process.stdout.write(deleted ? "API key removed.\n" : "No API key was configured.\n");
  });

const trace = program.command("trace").description("inspect local redacted traces");

trace.command("list")
  .description("list recent trace files")
  .option("--trace-root <path>", "trace directory")
  .action(async (options: { traceRoot?: string }) => {
    const root = options.traceRoot ?? await defaultTraceRoot();
    const files = await readTraceStore(root).list();
    process.stdout.write(files.map((file) => `${file.runId} ${file.sizeBytes}`).join("\n"));
    if (files.length > 0) process.stdout.write("\n");
  });

trace.command("show <run-id>")
  .description("print a redacted JSONL trace")
  .option("--trace-root <path>", "trace directory")
  .action(async (runId: string, options: { traceRoot?: string }) => {
    const root = options.traceRoot ?? await defaultTraceRoot();
    const events = await readTraceStore(root).show(runId);
    process.stdout.write(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  });

trace.command("export <run-id>")
  .description("export a trace without process arguments")
  .option("--trace-root <path>", "trace directory")
  .action(async (runId: string, options: { traceRoot?: string }) => {
    const root = options.traceRoot ?? await defaultTraceRoot();
    process.stdout.write(await readTraceStore(root).export(runId));
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = message === "NO_API_KEY" ? 4 : 2;
});
