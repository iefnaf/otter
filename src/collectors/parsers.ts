import { z } from "zod";
import type { MemoryStats, PortBinding } from "../snapshot/schema.ts";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly user: string;
  readonly state: string;
  readonly controllingTerminal: string;
  readonly lifetimeCpuPercent: number;
  readonly memoryPercent: number;
  readonly rssMb: number;
  readonly vszMb: number;
  readonly startTime: string;
  readonly elapsed: string;
  readonly cpuTime: string;
  readonly command: string;
}

export interface ProcessSample {
  readonly timestampMs: number;
  readonly rows: readonly ProcessRow[];
}

function integer(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${field}`);
  return parsed;
}

function decimal(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${field}`);
  return parsed;
}

export function parseArch(value: string): "arm64" | "x86_64" {
  const arch = value.trim();
  if (arch !== "arm64" && arch !== "x86_64") {
    throw new Error("unsupported architecture");
  }
  return arch;
}

export function parseBootTime(value: string): string {
  const match = /\bsec = (\d+)/.exec(value);
  if (match === null) throw new Error("invalid boot time");
  const seconds = integer(match[1] ?? "", "boot seconds");
  return new Date(seconds * 1000).toISOString();
}

export function parseLoadAverage(value: string): readonly [
  number,
  number,
  number,
] {
  const match = /\{ ([0-9.]+) ([0-9.]+) ([0-9.]+) \}/.exec(value);
  if (match === null) throw new Error("invalid load average");
  return [
    decimal(match[1] ?? "", "load 1"),
    decimal(match[2] ?? "", "load 5"),
    decimal(match[3] ?? "", "load 15"),
  ];
}

export function parseCpuTime(value: string): number {
  const trimmed = value.trim();
  const dayMatch = /^(\d+)-(.+)$/.exec(trimmed);
  const days = dayMatch === null ? 0 : integer(dayMatch[1] ?? "", "cpu days");
  const time = dayMatch === null ? trimmed : dayMatch[2] ?? "";
  const parts = time.split(":");
  if (parts.length < 2 || parts.length > 3) throw new Error("invalid cpu time");
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + decimal(part, "cpu time");
  return days * 86400 + seconds;
}

export function parseElapsedSeconds(value: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (match === null) throw new Error("invalid elapsed time");
  const days = match[1] === undefined ? 0 : integer(match[1], "elapsed days");
  const hours = match[2] === undefined ? 0 : integer(match[2], "elapsed hours");
  const minutes = integer(match[3] ?? "", "elapsed minutes");
  const seconds = integer(match[4] ?? "", "elapsed seconds");
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function parseProcessSample(
  output: string,
  timestampMs = Date.now(),
): ProcessSample {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0];
  if (header === undefined || !header.includes("COMMAND")) {
    throw new Error("missing ps header");
  }

  const starts = {
    pid: 0,
    ppid: header.indexOf(" PPID "),
    pgid: header.indexOf(" PGID "),
    user: header.indexOf(" USER "),
    state: header.indexOf(" STAT "),
    terminal: header.indexOf(" TT "),
    cpu: header.indexOf("%CPU"),
    memory: header.indexOf("%MEM"),
    rss: header.indexOf(" RSS "),
    vsz: header.indexOf(" VSZ "),
    startTime: header.includes(" LSTART ") ? header.indexOf(" LSTART ") : header.indexOf(" STARTED "),
    elapsed: header.indexOf(" ELAPSED "),
    cpuTime: header.includes(" CPUTIME ") ? header.indexOf(" CPUTIME ") : header.indexOf(" TIME "),
    command: header.indexOf("COMMAND"),
  };

  for (const [field, start] of Object.entries(starts)) {
    if (start < 0) throw new Error(`missing ps column ${field}`);
  }

  const rows = lines.slice(1).map((line): ProcessRow => {
    const fields = line.trim().split(/\s+/);
    const pid = fields[0];
    const ppid = fields[1];
    const pgid = fields[2];
    const user = fields[3];
    const state = fields[4];
    const terminal = fields[5];
    const lifetimeCpu = fields[6];
    const memoryPercent = fields[7];
    const rss = fields[8];
    const vsz = fields[9];
    const rawStartTime = fields.slice(10, 15).join(" ");
    const elapsed = fields[15];
    const cpuTime = fields[16];
    const command = fields.slice(17).join(" ");
    if (
      pid === undefined || ppid === undefined || pgid === undefined ||
      user === undefined || state === undefined || terminal === undefined ||
      lifetimeCpu === undefined || memoryPercent === undefined ||
      rss === undefined || vsz === undefined || elapsed === undefined ||
      cpuTime === undefined || command === ""
    ) {
      throw new Error("ps row is missing numeric columns");
    }
    const startTime = new Date(rawStartTime);
    if (Number.isNaN(startTime.getTime())) throw new Error("invalid process start time");
    return {
      pid: integer(pid, "pid"),
      ppid: integer(ppid, "ppid"),
      pgid: integer(pgid, "pgid"),
      user,
      state,
      controllingTerminal: terminal,
      lifetimeCpuPercent: decimal(lifetimeCpu, "cpu"),
      memoryPercent: decimal(memoryPercent, "memory"),
      rssMb: decimal(rss, "rss") / 1024,
      vszMb: decimal(vsz, "vsz") / 1024,
      startTime: startTime.toISOString(),
      elapsed,
      cpuTime,
      command,
    };
  });
  const pids = new Set<number>();
  for (const row of rows) {
    if (pids.has(row.pid)) throw new Error(`duplicate ps pid ${row.pid}`);
    pids.add(row.pid);
  }
  return { timestampMs, rows };
}

export function calculateIntervalCpuForPid(
  first: ProcessSample,
  second: ProcessSample,
  pid: number,
): number | null {
  if (second.timestampMs <= first.timestampMs) return null;
  const firstRow = first.rows.find((row) => row.pid === pid);
  const secondRow = second.rows.find((row) => row.pid === pid);
  if (firstRow === undefined || secondRow === undefined) return null;
  if (firstRow.startTime !== secondRow.startTime || firstRow.command !== secondRow.command) {
    return null;
  }
  const deltaSeconds =
    parseCpuTime(secondRow.cpuTime) - parseCpuTime(firstRow.cpuTime);
  const intervalSeconds = (second.timestampMs - first.timestampMs) / 1000;
  return Math.max((deltaSeconds / intervalSeconds) * 100, 0);
}

const memoryLine = /^(Pages [^:]+|Anonymous pages|Speculative pages|Pages occupied by compressor):\s+(\d+)\.$/;

export function parseMemoryStatistics(
  vmStat: string,
  swapUsage: string,
): MemoryStats {
  const pageSizeMatch = /pages? (?:size )?of (\d+) bytes/.exec(vmStat);
  if (pageSizeMatch === null) throw new Error("missing vm_stat page size");
  const pageSizeBytes = integer(pageSizeMatch[1] ?? "", "page size");
  const pages = new Map<string, number>();

  for (const line of vmStat.split(/\r?\n/)) {
    const match = memoryLine.exec(line);
    if (match === null) continue;
    pages.set(match[1] ?? "", integer(match[2] ?? "", "page count"));
  }

  const mb = (name: string): number => {
    const count = pages.get(name);
    if (count === undefined) throw new Error(`missing ${name}`);
    return (count * pageSizeBytes) / (1024 * 1024);
  };

  const swapMatch =
    /total = ([0-9.]+)([KMGT])B?\s+used = ([0-9.]+)([KMGT])B?/.exec(swapUsage);
  if (swapMatch === null) throw new Error("invalid swap usage");
  const unitMultiplier: Record<string, number> = { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 };
  const totalUnit = unitMultiplier[swapMatch[2] ?? ""];
  const usedUnit = unitMultiplier[swapMatch[4] ?? ""];
  if (totalUnit === undefined || usedUnit === undefined) {
    throw new Error("invalid swap unit");
  }

  return {
    freeMb: mb("Pages free") + mb("Pages speculative"),
    activeMb: mb("Pages active"),
    inactiveMb: mb("Pages inactive"),
    compressedMb: mb("Pages occupied by compressor"),
    wiredMb: mb("Pages wired down"),
    swapTotalMb: decimal(swapMatch[1] ?? "", "swap total") * totalUnit,
    swapUsedMb: decimal(swapMatch[3] ?? "", "swap used") * usedUnit,
    pageSizeBytes,
  };
}

export function parsePortBindings(output: string): readonly PortBinding[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim() !== "" && line.includes("(LISTEN)"))
    .map((line): PortBinding => {
      const fields = line.trim().split(/\s+/);
      const name = fields[fields.length - 2] ?? "";
      const addressMatch = /^(.*):(\d+)$/.exec(name);
      if (addressMatch === null) throw new Error("invalid listening address");
      const pidField = fields[1];
      if (pidField === undefined) throw new Error("missing lsof pid");
      const processName = fields[0];
      if (processName === undefined) throw new Error("missing lsof process");
      return {
        pid: integer(pidField, "port pid"),
        port: integer(addressMatch[2] ?? "", "port"),
        protocol: "tcp",
        processName,
        address: addressMatch[1] ?? "",
      };
    });
}

export interface DockerContainerRecord {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: "running" | "paused" | "exited" | "restarting";
  readonly labels: Record<string, string>;
}

const dockerPsRecordSchema = z.object({
  ID: z.string().min(1),
  Names: z.string().min(1),
  Image: z.string().min(1),
  State: z.enum(["running", "paused", "exited", "restarting"]),
  Labels: z.record(z.string()).default({}),
});

export function parseDockerContainers(output: string): readonly DockerContainerRecord[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line): DockerContainerRecord => {
      const parsed = dockerPsRecordSchema.parse(JSON.parse(line));
      return {
        id: parsed.ID,
        name: parsed.Names,
        image: parsed.Image,
        state: parsed.State,
        labels: parsed.Labels,
      };
    });
}

const dockerInspectSchema = z.object({
  Name: z.string().min(1),
  Config: z.object({ Image: z.string().min(1), Labels: z.record(z.string()) }),
  State: z.object({
    Status: z.enum(["running", "paused", "exited", "restarting"]),
    Health: z
      .object({ Status: z.enum(["healthy", "unhealthy", "starting"]) })
      .nullable()
      .optional(),
  }),
  HostConfig: z.object({
    RestartPolicy: z.object({ Name: z.enum(["no", "always", "unless-stopped", "on-failure"]) }),
  }),
});

export interface DockerInspection {
  readonly name: string;
  readonly image: string;
  readonly state: "running" | "paused" | "exited" | "restarting";
  readonly health: "healthy" | "unhealthy" | "starting" | "none";
  readonly restartPolicy: "no" | "always" | "unless-stopped" | "on-failure";
  readonly labels: Record<string, string>;
}

export function parseDockerInspection(output: string): DockerInspection {
  const parsed = dockerInspectSchema.parse(JSON.parse(output));
  return {
    name: parsed.Name.replace(/^\//, ""),
    image: parsed.Config.Image,
    state: parsed.State.Status,
    health: parsed.State.Health?.Status ?? "none",
    restartPolicy: parsed.HostConfig.RestartPolicy.Name,
    labels: parsed.Config.Labels,
  };
}

const dockerStatsSchema = z.object({
  ID: z.string().min(1),
  CPUPerc: z.string(),
  MemUsage: z.string(),
});

export interface DockerStatsSample {
  readonly id: string;
  readonly cpuPercent: number | null;
  readonly memoryUsageMb: number;
}

function parseSizeToMb(value: string): number {
  const match = /^([0-9.]+)([KMGT])i?B$/.exec(value.trim());
  if (match === null) throw new Error("invalid Docker size");
  const multiplier: Record<string, number> = { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 };
  const unit = multiplier[match[2] ?? ""];
  if (unit === undefined) throw new Error("invalid Docker size unit");
  return decimal(match[1] ?? "", "Docker size") * unit;
}

export function parseDockerStats(output: string): readonly DockerStatsSample[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line): DockerStatsSample => {
      const parsed = dockerStatsSchema.parse(JSON.parse(line));
      const cpuText = parsed.CPUPerc.replace("%", "").trim();
      const memory = parsed.MemUsage.split("/")[0] ?? "";
      return {
        id: parsed.ID,
        cpuPercent: cpuText === "" ? null : decimal(cpuText, "Docker CPU"),
        memoryUsageMb: parseSizeToMb(memory),
      };
    });
}

export interface DockerInfo {
  readonly serverVersion: string;
  readonly reservedCpus: number | null;
  readonly reservedMemoryMb: number | null;
}

const dockerInfoSchema = z.object({
  ServerVersion: z.string().min(1),
  NCPU: z.number().positive().nullable(),
  MemTotal: z.number().nonnegative().nullable(),
});

export function parseDockerInfo(output: string): DockerInfo {
  const parsed = dockerInfoSchema.parse(JSON.parse(output));
  return {
    serverVersion: parsed.ServerVersion,
    reservedCpus: parsed.NCPU,
    reservedMemoryMb: parsed.MemTotal === null ? null : parsed.MemTotal / (1024 * 1024),
  };
}
