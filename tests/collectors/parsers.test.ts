import { describe, expect, test } from "bun:test";
import {
  calculateIntervalCpuForPid,
  parseBootTime,
  parseDockerContainers,
  parseDockerInspection,
  parseDockerStats,
  parseLoadAverage,
  parseMemoryStatistics,
  parsePortBindings,
  parseProcessSample,
} from "../../src/collectors/parsers.ts";
import { fixture } from "../helpers.ts";

describe("macOS command parsers", () => {
  test("parses fixed-width ps output and interval CPU", async () => {
    const first = parseProcessSample(await fixture("ps-first.txt"), 1_000);
    const second = parseProcessSample(await fixture("ps-second.txt"), 3_000);
    expect(first.rows).toHaveLength(3);
    expect(second.rows[0]?.command).toBe("/sbin/launchd");
    expect(second.rows[0]?.startTime).toBe("2025-10-29T09:00:00.000Z");
    expect(calculateIntervalCpuForPid(first, second, 1)).toBeCloseTo(5, 5);
    expect(calculateIntervalCpuForPid(first, second, 900)).toBeNull();
  });

  test("parses machine, load, memory, and ports", async () => {
    expect(parseBootTime("{ sec = 1761600000, usec = 0 } boot")).toBe("2025-10-27T21:20:00.000Z");
    expect(parseLoadAverage("{ 1.25 1.50 1.75 }")).toEqual([1.25, 1.5, 1.75]);
    const memory = parseMemoryStatistics(
      await fixture("vm-stat.txt"),
      await fixture("swapusage.txt"),
    );
    expect(memory.pageSizeBytes).toBe(16384);
    expect(memory.freeMb).toBeCloseTo(320, 5);
    expect(memory.compressedMb).toBeCloseTo(192, 5);
    expect(memory.swapUsedMb).toBeCloseTo(512, 5);
    const ports = parsePortBindings(await fixture("lsof.txt"));
    expect(ports).toEqual([
      { pid: 750, port: 3000, protocol: "tcp", processName: "node", address: "127.0.0.1" },
      { pid: 800, port: 6379, protocol: "tcp", processName: "redis", address: "*" },
    ]);
  });

  test("parses Docker container records, inspection, and paired stats", async () => {
    const containers = parseDockerContainers(
      '{"ID":"abcdef0123456789","Names":"project-cache","Image":"redis:7","State":"running","Labels":{"otter.disposable":"true"}}\n',
    );
    expect(containers[0]?.labels["otter.disposable"]).toBe("true");
    const cliLabels = parseDockerContainers(
      '{"ID":"abcdef0123456789","Names":"project-cache","Image":"redis:7","State":"running","Labels":"otter.disposable=true,other=yes"}\n',
    );
    expect(cliLabels[0]?.labels).toEqual({ "otter.disposable": "true", other: "yes" });
    const inspection = parseDockerInspection(await fixture("docker-inspect.json"));
    expect(inspection).toEqual({
      id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      name: "project-cache",
      startedAt: "2026-10-01T00:00:00.000Z",
      image: "redis:7",
      state: "running",
      health: "healthy",
      restartPolicy: "no",
      labels: { "otter.disposable": "true" },
    });
    const stats = parseDockerStats(await fixture("docker-stats.txt"));
    expect(stats).toHaveLength(2);
    expect(stats[0]?.memoryUsageMb).toBeCloseTo(16, 5);
    expect(stats[1]?.cpuPercent).toBeCloseTo(0.3, 5);
  });
});
