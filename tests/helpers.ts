import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemSnapshot } from "../src/snapshot/schema.ts";
import type { CommandOutput, CommandRunner } from "../src/collectors/types.ts";

export async function fixture(name: string): Promise<string> {
  return readFile(join(import.meta.dir, "fixtures", name), "utf8");
}

export function output(stdout: string, exitCode = 0): CommandOutput {
  return { stdout, stderr: "", exitCode };
}

export async function createFixtureRunner(): Promise<CommandRunner> {
  const psSecond = await fixture("ps-second.txt");
  const vmStat = await fixture("vm-stat.txt");
  const swap = await fixture("swapusage.txt");
  const lsof = await fixture("lsof.txt");
  const dockerInfo = JSON.stringify({
    ServerVersion: "27.0.0",
    NCPU: 4,
    MemTotal: 8 * 1024 * 1024 * 1024,
  });
  const dockerPs = JSON.stringify({
    ID: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    Names: "project-cache",
    Image: "redis:7",
    State: "running",
    Labels: { "otter.disposable": "true" },
  });
  const dockerInspect = await fixture("docker-inspect.json");
  const dockerStats = await fixture("docker-stats.txt");
  const runner: CommandRunner = async (_command, args) => {
    const key = args.join(" ");
    if (key === "-n hw.machine") return output("arm64");
    if (key === "-n hw.ncpu") return output("10");
    if (key === "-n hw.memsize") return output("34359738368");
    if (key === "-n kern.osproductversion") return output("15.1");
    if (key === "-n kern.boottime") return output("{ sec = 1761600000, usec = 0 } Sat Sep  1 00:00:00 2026");
    if (key === "-n vm.loadavg") return output("{ 1.25 1.50 1.75 }");
    if (key === "-eo pid,ppid,pgid,user,stat,tt,%cpu,%mem,rss,vsz,lstart,etime,cputime,command") {
      return output(psSecond);
    }
    if (key === "") return output(vmStat);
    if (key === "-n vm.swapusage") return output(swap);
    if (key === "-iTCP -sTCP:LISTEN -n -P") return output(lsof);
    if (key === "list") return output("PID Status Label\n0 0 com.apple.session\n");
    if (key === "info --format {{json .}}") return output(dockerInfo);
    if (key === "ps --no-trunc --format json") return output(dockerPs);
    if (key.startsWith("inspect --format")) return output(dockerInspect);
    if (key === "stats --no-stream --format json") return output(dockerStats);
    return output("", 1);
  };
  return runner;
}

export function snapshotFixture(): SystemSnapshot {
  const processes = Array.from({ length: 60 }, (_value, index): SystemSnapshot["processes"][number] => ({
    pid: 1000 + index,
    ppid: 1,
    pgid: 1000 + index,
    user: index === 59 ? "fanfei" : "_daemon",
    state: "S",
    controllingTerminal: index === 59 ? "??" : "ttys000",
    lifetimeCpuPercent: index,
    memoryPercent: index / 10,
    rssMb: index === 59 ? 10 : index * 10,
    vszMb: index * 100,
    startTime: "Wed Oct 29 09:00:00 2025",
    elapsed: index === 59 ? "9-00:00:00" : "01:00:00",
    cpuTime: "01:00.00",
    intervalCpuPercent: index === 0 ? 50 : index === 59 ? 0 : index / 2,
    command: index === 59
      ? "/Users/fanfei/project/bin/node --token abcdefghijklmnopqrstuvwxyz"
      : `/usr/libexec/daemon-${index}`,
    entityId: `proc_${String(10000000 + index).padStart(8, "0")}-0000-4000-8000-000000000000`,
  }));
  return {
    schemaVersion: "1.0",
    collectedAt: "2026-10-30T00:00:00.000Z",
    collectionWindowSeconds: 2,
    machine: {
      arch: "arm64",
      cpuCores: 10,
      totalMemoryGb: 32,
      macosVersion: "15.1",
      bootTime: "2026-09-01T00:00:00.000Z",
      uptimeHours: 24,
    },
    memory: {
      freeMb: 512,
      activeMb: 4096,
      inactiveMb: 1024,
      compressedMb: 2048,
      wiredMb: 3072,
      swapTotalMb: 2048,
      swapUsedMb: 512,
      pageSizeBytes: 16384,
    },
    load: { oneMinute: 1.25, fiveMinute: 1.5, fifteenMinute: 1.75 },
    processes,
    ports: [{ pid: 1059, port: 3000, protocol: "tcp", processName: "node", address: "127.0.0.1" }],
    docker: {
      daemonAvailable: true,
      daemonVersion: "27.0.0",
      vmProcess: null,
      containers: [{
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        startedAt: "2026-10-01T00:00:00.000Z",
        name: "project-cache",
        image: "redis:7",
        state: "running",
        health: "healthy",
        restartPolicy: "no",
        intervalCpuPercent: 0.2,
        memoryUsageMb: 18,
        entityId: "container_10000000-0000-4000-8000-000000000000",
        labels: { "otter.disposable": "true" },
      }],
    },
    collectorStatus: [
      { name: "machine", status: "complete", error: null, durationMs: 10 },
      { name: "memory", status: "complete", error: null, durationMs: 10 },
      { name: "process", status: "complete", error: null, durationMs: 20 },
      { name: "ports", status: "complete", error: null, durationMs: 10 },
      { name: "docker", status: "complete", error: null, durationMs: 10 },
    ],
  };
}
