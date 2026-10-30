import type { CommandRunner } from "../collectors/types.ts";
import { createProcessCollector } from "../collectors/process.ts";
import { createPortCollector } from "../collectors/ports.ts";
import { parseDockerInspection, parseDockerStats } from "../collectors/parsers.ts";
import type { ProcessInfo } from "../snapshot/schema.ts";
import type { ProcessCandidate, ContainerCandidate } from "../candidates/types.ts";
import { validateContainer, validateProcess } from "./safety.ts";

export type RevalidationResult =
  | { readonly status: "ok"; readonly process?: ProcessInfo; readonly activeChildCount?: number }
  | { readonly status: "already_done" }
  | { readonly status: "target_changed"; readonly reason: string }
  | { readonly status: "unknown"; readonly reason: string };

export function parseLaunchctlPids(output: string): readonly number[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0] ?? "";
  if (!/^\s*PID\s+Status\s+Label\b/.test(header)) {
    throw new Error("invalid launchctl output");
  }
  return lines
    .slice(1)
    .flatMap((line) => {
      const value = line.trim().split(/\s+/)[0];
      return value !== undefined && /^\d+$/.test(value) ? [Number.parseInt(value, 10)] : [];
    });
}

export async function collectServicePids(
  runner: CommandRunner,
): Promise<ReadonlySet<number> | null> {
  const output = await runner("launchctl", ["list"], { timeoutMs: 5000 });
  if (output.exitCode !== 0) return null;
  try {
    return new Set(parseLaunchctlPids(output.stdout));
  } catch {
    return null;
  }
}

export async function revalidateProcessCandidate(
  candidate: ProcessCandidate,
  runner: CommandRunner,
  currentUser: string,
  sampleWindowSeconds = 1,
): Promise<RevalidationResult> {
  const [processResult, portResult, services] = await Promise.all([
    createProcessCollector(runner, sampleWindowSeconds)(),
    createPortCollector(runner)(),
    collectServicePids(runner),
  ]);
  if (
    processResult.data === null ||
    portResult.data === null ||
    portResult.status !== "complete"
  ) {
    return { status: "unknown", reason: "fresh process or port collection failed" };
  }
  const process = processResult.data.find((item) => item.pid === candidate.pid);
  if (process === undefined) return { status: "already_done" };
  if (process.startTime !== candidate.startTime || process.command !== candidate.command) {
    return { status: "target_changed", reason: "PID identity changed" };
  }
  if (process.user !== currentUser) {
    return { status: "target_changed", reason: "process ownership changed" };
  }
  const ports = portResult.data
    .filter((port) => port.pid === candidate.pid)
    .map((port) => port.port);
  const activeChildCount = processResult.data
    .filter((item) => item.ppid === process.pid && !item.state.includes("Z"))
    .length;
  const decision = validateProcess(process, ports, currentUser, services, activeChildCount);
  if (decision.status === "unknown") return { status: "unknown", reason: "service-manager state is unknown" };
  if (decision.status === "blocked") {
    return { status: "target_changed", reason: "process no longer passes the local safety predicate" };
  }
  return { status: "ok", process, activeChildCount };
}

export async function revalidateContainerCandidate(
  candidate: ContainerCandidate,
  runner: CommandRunner,
  sampleWindowSeconds = 1,
): Promise<RevalidationResult> {
  const inspectOutput = await runner(
    "docker",
    ["inspect", "--format", "{{json .}}", candidate.containerId],
    { timeoutMs: 10_000 },
  );
  if (inspectOutput.exitCode !== 0) {
    return { status: "unknown", reason: "docker inspect failed" };
  }
  let inspection;
  try {
    inspection = parseDockerInspection(inspectOutput.stdout);
  } catch {
    return { status: "unknown", reason: "docker inspection could not be parsed" };
  }
  if (
    inspection.id !== candidate.containerId ||
    inspection.startedAt !== candidate.startedAt ||
    inspection.name !== candidate.name ||
    inspection.restartPolicy !== candidate.restartPolicy ||
    inspection.labels["otter.disposable"] !== "true"
  ) {
    return { status: "target_changed", reason: "container identity, policy, or disposable label changed" };
  }
  if (inspection.state === "exited") return { status: "already_done" };
  const statsOutputs: string[] = [];
  for (const sampleIndex of [0, 1]) {
    if (sampleIndex === 1) {
      await new Promise((resolve) => setTimeout(resolve, sampleWindowSeconds * 1000));
    }
    const statsOutput = await runner(
      "docker",
      ["stats", "--no-stream", "--format", "json"],
      { timeoutMs: 10_000 },
    );
    if (statsOutput.exitCode !== 0) return { status: "unknown", reason: "docker stats failed" };
    statsOutputs.push(statsOutput.stdout);
  }
  const samples = statsOutputs.flatMap((stdout) => {
    try {
      return [parseDockerStats(stdout).find((sample) => candidate.containerId.startsWith(sample.id)) ?? null];
    } catch {
      return [null];
    }
  });
  const [firstSample, secondSample] = samples;
  if (firstSample === undefined || secondSample === undefined ||
    firstSample === null || secondSample === null) {
    return { status: "unknown", reason: "docker stats could not be parsed" };
  }
  const intervalCpuPercent =
    firstSample.cpuPercent === null || secondSample.cpuPercent === null
      ? null
      : (firstSample.cpuPercent + secondSample.cpuPercent) / 2;
  const freshContainer = {
    id: candidate.containerId,
    startedAt: inspection.startedAt,
    name: inspection.name,
    image: inspection.image,
    state: inspection.state,
    health: inspection.health,
    restartPolicy: inspection.restartPolicy,
    intervalCpuPercent,
    memoryUsageMb: secondSample.memoryUsageMb,
    entityId: candidate.entityId,
    labels: inspection.labels,
  };
  const decision = validateContainer(freshContainer, freshContainer.intervalCpuPercent);
  if (decision.status !== "eligible") {
    return { status: "target_changed", reason: "container no longer passes the local safety predicate" };
  }
  return { status: "ok" };
}
