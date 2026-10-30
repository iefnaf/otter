import { describe, expect, test } from "bun:test";
import { localCommandRunner } from "../../src/collectors/runner.ts";

describe("local command runner", () => {
  test("forces the C locale for deterministic command output", async () => {
    const output = await localCommandRunner("env", [], { timeoutMs: 5000 });
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("LC_ALL=C");
    expect(output.stdout).toContain("LANG=C");
  });
});
