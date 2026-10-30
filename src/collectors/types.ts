export const collectorStatuses: readonly [
  "complete",
  "partial",
  "failed",
  "skipped",
  "denied",
] = [
  "complete",
  "partial",
  "failed",
  "skipped",
  "denied",
];

export type CollectorStatusName = (typeof collectorStatuses)[number];

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunOptions {
  readonly timeoutMs: number;
  readonly stdin?: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
) => Promise<CommandOutput>;

export interface CollectorResult<T> {
  readonly name: CollectorName;
  readonly status: CollectorStatusName;
  readonly data: T | null;
  readonly error: string | null;
  readonly durationMs: number;
}

export type CollectorName =
  | "machine"
  | "memory"
  | "process"
  | "ports"
  | "docker";

export async function runCollector<T>(
  name: CollectorName,
  collect: () => Promise<CollectorResult<T>>,
): Promise<CollectorResult<T>> {
  const startedAt = Date.now();
  try {
    return await collect();
  } catch (error) {
    return {
      name,
      status: "failed",
      data: null,
      error: error instanceof Error ? error.message : "collector failed",
      durationMs: Date.now() - startedAt,
    };
  }
}
