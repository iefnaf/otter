import { describe, expect, test } from "bun:test";
import { buildCandidateBook } from "../../src/candidates/build.ts";
import type { ContainerCandidate, ProcessCandidate } from "../../src/candidates/types.ts";
import { killProcess, stopContainer } from "../../src/executor/actions.ts";
import type { ProcessControl } from "../../src/executor/types.ts";
import { fixture, output, snapshotFixture } from "../helpers.ts";
import type { CommandRunner } from "../../src/collectors/types.ts";

const psHeader = "  PID  PPID  PGID   USER   STAT TT  %CPU %MEM      RSS       VSZ LSTART                      ELAPSED CPUTIME COMMAND";
const psTarget = " 1059     1  1059 fanfei     S  ??   0.0  0.1    524288   2097152 Wed Oct 29 09:00:00 2025  9-00:00:00 00:00.20 /usr/local/bin/node server.js";

function processCandidate(): ProcessCandidate {
  const base = buildCandidateBook(snapshotFixture(), "fanfei", "20261030T000000-abcdef")
    .records
    .find((item): item is ProcessCandidate => item.kind === "process" && item.pid === 1059);
  if (base === undefined) throw new Error("missing process candidate");
  return {
    ...base,
    startTime: "2025-10-29T09:00:00.000Z",
    command: "/usr/local/bin/node server.js",
  };
}

function processRunner(commandAfterFirstRevalidation = "/usr/local/bin/node server.js"): {
  runner: CommandRunner;
  psGroups: () => number;
} {
  let groups = 0;
  const runner: CommandRunner = async (_command, args) => {
    const key = args.join(" ");
    if (key.startsWith("-eo pid,")) {
      if (key.includes("lstart")) groups += 1;
      const command = groups <= 2
        ? "/usr/local/bin/node server.js"
        : commandAfterFirstRevalidation;
      return output(`${psHeader}\n${psTarget.replace("/usr/local/bin/node server.js", command)}\n`);
    }
    if (key === "-iTCP -sTCP:LISTEN -n -P") {
      return output("COMMAND   PID USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME\nnode    1059 fanfei   24u  IPv4  0x1234      0t0  TCP 127.0.0.1:3000 (LISTEN)\n");
    }
    if (key === "list") return output("PID Status Label\n0 0 com.apple.session\n");
    return output("", 1);
  };
  return { runner, psGroups: () => groups };
}

function processControl(options: {
  readonly failSigterm?: boolean;
  readonly exitOnSigkill?: boolean;
  readonly stayAlive?: boolean;
} = {}): ProcessControl & { readonly signals: readonly string[] } {
  const signals: string[] = [];
  let alive = true;
  return {
    signals,
    kill(pid, signal) {
      signals.push(signal);
      if (signal === "SIGTERM" && options.failSigterm) throw new Error(`permission denied ${pid}`);
      if (signal === "SIGKILL" && options.exitOnSigkill) alive = false;
    },
    alive: () => alive,
  };
}

function containerCandidate(): ContainerCandidate {
  const candidate = buildCandidateBook(snapshotFixture(), "fanfei", "20261030T000000-abcdef")
    .records
    .find((item): item is ContainerCandidate => item.kind === "container");
  if (candidate === undefined) throw new Error("missing container candidate");
  return candidate;
}

describe("executor", () => {
  test("kill uses SIGTERM, revalidates identity, then SIGKILL only if needed", async () => {
    const { runner } = processRunner();
    const control = processControl({ exitOnSigkill: true });
    const result = await killProcess(processCandidate(), {
      runner,
      currentUser: "fanfei",
      processControl: control,
      waitMs: () => Promise.resolve(),
      revalidationWindowSeconds: 0.05,
    });
    expect(result).toEqual({
      candidateId: result.candidateId,
      actionType: "kill_process",
      status: "succeeded",
      errorCode: null,
      message: "Process exited after SIGKILL.",
    });
    expect(control.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("kill blocks SIGKILL when identity changes after SIGTERM", async () => {
    const { runner } = processRunner("/usr/local/bin/attacker");
    const control = processControl();
    const result = await killProcess(processCandidate(), {
      runner,
      currentUser: "fanfei",
      processControl: control,
      waitMs: () => Promise.resolve(),
      revalidationWindowSeconds: 0.05,
    });
    expect(result.status).toBe("target_changed");
    expect(result.errorCode).toBe("TARGET_CHANGED");
    expect(control.signals).toEqual(["SIGTERM"]);
  });

  test("kill reports a signal failure without echoing system errors", async () => {
    const { runner } = processRunner();
    const control = processControl({ failSigterm: true });
    const result = await killProcess(processCandidate(), {
      runner,
      currentUser: "fanfei",
      processControl: control,
      waitMs: () => Promise.resolve(),
      revalidationWindowSeconds: 0.05,
    });
    expect(result.status).toBe("failed");
    expect(result.message).toBe("sending SIGTERM failed");
    expect(result.message.includes("permission")).toBe(false);
  });

  test("stop uses a fixed Docker command and verifies the exited state", async () => {
    const commands: string[] = [];
    let inspectCount = 0;
    const runningInspection = await fixture("docker-inspect.json");
    const runner: CommandRunner = async (_command, args) => {
      const key = args.join(" ");
      commands.push(key);
      if (key.startsWith("inspect --format")) {
        inspectCount += 1;
        return output(inspectCount >= 2 ? runningInspection.replace('"running"', '"exited"') : runningInspection);
      }
      if (key === "stats --no-stream --format json") {
        return output('{"ID":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","CPUPerc":"0.20%","MemUsage":"18MiB / 8GiB"}\n');
      }
      if (key === "stop abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789") {
        return output("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789\n");
      }
      return output("", 1);
    };
    const result = await stopContainer(containerCandidate(), {
      runner,
      currentUser: "fanfei",
      revalidationWindowSeconds: 0.05,
    });
    expect(result.status).toBe("succeeded");
    expect(commands).toContain("stop abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
  });
});
