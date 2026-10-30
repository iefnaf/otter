import { describe, expect, test } from "bun:test";
import { buildCandidateBook } from "../../src/candidates/build.ts";
import { validateCandidates, validateContainer, validateProcess } from "../../src/validator/safety.ts";
import { snapshotFixture } from "../helpers.ts";

describe("validator safety", () => {
  test("accepts only the complete stale-process predicate", () => {
    const process = snapshotFixture().processes[59]!;
    const ports = [3000];
    const accepted = validateProcess(process, ports, "fanfei", new Set(), 0);
    expect(accepted.status).toBe("eligible");

    const rejections = [
      validateProcess({ ...process, user: "root" }, ports, "fanfei", new Set(), 0),
      validateProcess({ ...process, user: "_windowserver" }, ports, "fanfei", new Set(), 0),
      validateProcess({ ...process, state: "Z" }, ports, "fanfei", new Set(), 0),
      validateProcess(process, [], "fanfei", new Set(), 0),
      validateProcess({ ...process, intervalCpuPercent: 2 }, ports, "fanfei", new Set(), 0),
      validateProcess({ ...process, elapsed: "01:00:00" }, ports, "fanfei", new Set(), 0),
      validateProcess({ ...process, controllingTerminal: "ttys000" }, ports, "fanfei", new Set(), 0),
      validateProcess(process, ports, "fanfei", new Set([process.pid]), 0),
      validateProcess(process, ports, "fanfei", new Set(), 1),
      validateProcess(process, ports, "fanfei", null, 0),
    ];
    expect(rejections.every((decision) => decision.status !== "eligible")).toBe(true);
  });

  test("accepts only disposable idle containers in a stoppable state", () => {
    const container = snapshotFixture().docker.containers[0]!;
    expect(validateContainer(container, 0.2).status).toBe("eligible");

    const rejections = [
      validateContainer({ ...container, labels: {} }, 0.2),
      validateContainer({ ...container, state: "exited" }, 0.2),
      validateContainer({ ...container, health: "unhealthy" }, 0.2),
      validateContainer({ ...container, restartPolicy: "always" }, 0.2),
      validateContainer(container, null),
      validateContainer(container, 2),
    ];
    expect(rejections.every((decision) => decision.status === "blocked")).toBe(true);
  });

  test("validates candidates against the private snapshot, not analyzer output", () => {
    const snapshot = snapshotFixture();
    const book = buildCandidateBook(snapshot, "fanfei", "20261030T000000-abcdef");
    const ports = new Map([[1059, [3000]]]);
    const validated = validateCandidates(
      book.records,
      snapshot.processes,
      snapshot.docker.containers,
      ports,
      "fanfei",
      new Set(),
    );
    expect(validated.map((candidate) => candidate.eligibility.status)).toEqual(["eligible", "eligible"]);
  });
});
