import type { DiagnosticOptions } from "./pipeline.ts";

export interface DiagnosticCliOptions {
  readonly json?: boolean;
  readonly localOnly?: boolean;
  readonly previewPayload?: boolean;
  readonly sendLlm?: boolean;
  readonly dryRun?: boolean;
  readonly verbose?: boolean;
  readonly window: number;
}

// Maps parsed CLI flags to pipeline options. Every flag the command declares must be forwarded here.
export function diagnosticOptionsFromCli(
  command: DiagnosticOptions["command"],
  options: DiagnosticCliOptions,
  environment: {
    readonly stdoutIsTty: boolean;
    readonly traceRoot: string;
    readonly configRoot: string;
  },
): DiagnosticOptions {
  return {
    command,
    json: options.json === true || !environment.stdoutIsTty,
    localOnly: options.localOnly === true,
    previewPayload: options.previewPayload === true,
    sendLlm: options.sendLlm === true,
    dryRun: options.dryRun === true,
    verbose: options.verbose === true,
    windowSeconds: options.window,
    traceRoot: environment.traceRoot,
    configRoot: environment.configRoot,
  };
}
