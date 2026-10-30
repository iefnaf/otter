import { describe, expect, test } from "bun:test";
import { redactSnapshot } from "../../src/redactor/redact.ts";
import { snapshotFixture } from "../helpers.ts";

describe("redaction and process tiers", () => {
  test("omits process arguments and derives bounded tiers plus opaque candidates", () => {
    const snapshot = snapshotFixture();
    const result = redactSnapshot(snapshot, { runId: "20261030T000000-abcdef", currentUser: "fanfei" });
    const serialized = JSON.stringify(result.payload);
    expect(serialized.includes("--token")).toBe(false);
    expect(serialized.includes("abcdefghijklmnop")).toBe(false);
    expect(serialized.includes("/Users/fanfei/project")).toBe(false);
    expect(serialized.includes('"fanfei"')).toBe(false);
    expect(result.payload.processTiers.detail.length).toBeLessThanOrEqual(50);
    expect(result.payload.processTiers.candidates.map((process) => process.pid)).toEqual([1059]);
    expect(result.payload.processTiers.summary.length).toBeGreaterThan(0);
    expect(Object.hasOwn(result.payload.processTiers.detail[0] ?? {}, "command")).toBe(false);

    const candidate = result.payload.candidateBook.find((item) => item.kind === "process");
    expect(candidate?.candidateId).toMatch(/^cand_[0-9a-f]{12}$/);
    expect(serialized.includes(candidate?.candidateId ?? "")).toBe(true);
    expect(JSON.stringify(candidate).includes("entityId")).toBe(false);
    expect(result.payload.docker.containers[0]?.name).not.toBe("project-cache");
  });
});
