import { describe, expect, test } from "bun:test";
import { buildCandidateBook } from "../../src/candidates/build.ts";
import type { ProcessCandidate } from "../../src/candidates/types.ts";
import {
  parseLaunchctlPids,
  revalidateContainerCandidate,
  revalidateProcessCandidate,
} from "../../src/validator/revalidate.ts";
import { output, snapshotFixture } from "../helpers.ts";
import type { CommandRunner } from "../../src/collectors/types.ts";
import type { SystemSnapshot } from "../../src/snapshot/schema.ts";

const psHeader = "  PID  PPID  PGID   USER   STAT TT  %CPU %MEM      RSS       VSZ LSTART                      ELAPSED CPUTIME COMMAND";

function psRow(): string {
  return " 1059     1  1059 fanfei     S  ??   0.0  0.1    524288   2097152 Wed Oct 29 09:00:00 2025  9-00:00:00 00:00.20 /usr/local/bin/node server.js";
}

function processSnapshot(): { snapshot: SystemSnapshot; candidate: ProcessCandidate } {
  const source = snapshotFixture();
  const processes = source.processes.map((process) =>
    process.pid === 1059
      ? {
        ...process,
        startTime: "2025-10-29T09:00:00.000Z",
        command: "/usr/local/bin/node server.js",
      }
      : process,
  );
  const snapshot = { ...source, processes };
  const candidate = buildCandidateBook(snapshot, "fanfei", "20261030T000000-abcdef")
    .records
    .find((item): item is ProcessCandidate => item.kind === "process" && item.pid === 1059);
  if (candidate === undefined) throw new Error("fixture has no process candidate");
  return { snapshot, candidate };
}

function processRunner(options: {
  readonly includeTarget?: boolean;
  readonly command?: string;
  readonly childPpid?: number;
  readonly servicePids?: string;
  readonly listening?: boolean;
} = {}): CommandRunner {
  const rows = [
    ...(options.includeTarget === false ? [] : [psRow().replace(
      "/usr/local/bin/node server.js",
      options.command ?? "/usr/local/bin/node server.js",
    )]),
    ...(options.childPpid === undefined
      ? []
      : [` 2000 ${options.childPpid}  2000 fanfei     S  ??   0.0  0.1     16384     65536 Wed Oct 29 09:00:00 2025  1-00:00:00 00:00.00 /bin/child`]),
  ];
  return async (_command, args) => {
    const key = args.join(" ");
    if (key.startsWith("-eo pid,")) return output(`${psHeader}\n${rows.join("\n")}\n`);
    if (key === "-iTCP -sTCP:LISTEN -n -P") {
      return output(options.listening === false
        ? "COMMAND   PID USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME\n"
        : "COMMAND   PID USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME\nnode    1059 fanfei   24u  IPv4  0x1234      0t0  TCP 127.0.0.1:3000 (LISTEN)\n");
    }
    if (key === "list") return output(options.servicePids ?? "PID Status Label\n0 0 com.apple.session\n");
    return output("", 1);
  };
}

function containerCandidate() {
  const snapshot = snapshotFixture();
  const candidate = buildCandidateBook(snapshot, "fanfei", "20261030T000000-abcdef")
    .records
    .find((item): item is Extract<typeof item, { kind: "container" }> => item.kind === "container");
  if (candidate === undefined) throw new Error("fixture has no container candidate");
  return candidate;
}

function dockerInspection(state: {
  readonly status?: string;
  readonly policy?: string;
  readonly label?: string;
} = {}): string {
  return JSON.stringify({
    Id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    Name: "/project-cache",
    Config: {
      Image: "redis:7",
      Labels: { "otter.disposable": state.label ?? "true" },
    },
    State: {
      Status: state.status ?? "running",
      StartedAt: "2026-10-01T00:00:00.000Z",
      Health: { Status: "healthy" },
    },
    HostConfig: { RestartPolicy: { Name: state.policy ?? "no" } },
  });
}

describe("pre-action revalidation", () => {
  test("parses launchctl PID values without treating labels as PIDs", () => {
    expect(parseLaunchctlPids("PID Status Label\n1059 0 com.example\n- 0 com.apple\n"))
      .toEqual([1059]);
  });

  test("accepts an unchanged process and rejects changed or unknown state", async () => {
    const { candidate } = processSnapshot();
    const ok = await revalidateProcessCandidate(candidate, processRunner(), "fanfei", 0.05);
    expect(ok.status).toBe("ok");

    const gone = await revalidateProcessCandidate(
      candidate,
      processRunner({ includeTarget: false }),
      "fanfei",
      0.05,
    );
    expect(gone).toEqual({ status: "already_done" });

    const reused = await revalidateProcessCandidate(
      candidate,
      processRunner({ command: "/usr/local/bin/other" }),
      "fanfei",
      0.05,
    );
    expect(reused.status).toBe("target_changed");

    const child = await revalidateProcessCandidate(
      candidate,
      processRunner({ childPpid: 1059 }),
      "fanfei",
      0.05,
    );
    expect(child.status).toBe("target_changed");

    const managed = await revalidateProcessCandidate(
      candidate,
      processRunner({ servicePids: "PID Status Label\n1059 0 com.example\n" }),
      "fanfei",
      0.05,
    );
    expect(managed.status).toBe("target_changed");

    const noPort = await revalidateProcessCandidate(
      candidate,
      processRunner({ listening: false }),
      "fanfei",
      0.05,
    );
    expect(noPort.status).toBe("target_changed");

    const unknownServices = await revalidateProcessCandidate(
      candidate,
      processRunner({ servicePids: "" }),
      "fanfei",
      0.05,
    );
    expect(unknownServices.status).toBe("unknown");
  });

  test("accepts an unchanged disposable container and blocks fresh mismatches", async () => {
    const candidate = containerCandidate();
    const runner: CommandRunner = async (_command, args) => {
      const key = args.join(" ");
      if (key.startsWith("inspect --format")) return output(dockerInspection());
      if (key === "stats --no-stream --format json") {
        return output('{"ID":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","CPUPerc":"0.20%","MemUsage":"18MiB / 8GiB"}\n');
      }
      return output("", 1);
    };
    expect((await revalidateContainerCandidate(candidate, runner, 0.05)).status).toBe("ok");

    const exited = await revalidateContainerCandidate(candidate, async (_command, args) =>
      args.includes("inspect")
        ? output(dockerInspection({ status: "exited" }))
        : output("", 1), 0.05);
    expect(exited.status).toBe("already_done");

    const changed = await revalidateContainerCandidate(candidate, async (_command, args) =>
      args.includes("inspect")
        ? output(dockerInspection({ policy: "always" }))
        : output("", 1), 0.05);
    expect(changed.status).toBe("target_changed");

    const unknown = await revalidateContainerCandidate(candidate, async (_command, args) =>
      args.includes("inspect") ? output("not-json") : output("", 1), 0.05);
    expect(unknown.status).toBe("unknown");
  });
});
