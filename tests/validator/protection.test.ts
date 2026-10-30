import { describe, expect, test } from "bun:test";
import { buildCandidateBook } from "../../src/candidates/build.ts";
import { snapshotFixture } from "../helpers.ts";
import { validateCandidates } from "../../src/validator/safety.ts";
import {
  isBuiltInProtectionRule,
  matchProtection,
  protectionRules,
} from "../../src/validator/protection.ts";

describe("executable protection", () => {
  test("covers common network tools and matches executable names case-insensitively", () => {
    for (const executable of [
      "clash",
      "Clash Verge",
      "Surge",
      "v2ray",
      "Shadowrocket",
      "Tailscale",
    ]) {
      expect(isBuiltInProtectionRule(executable)).toBe(true);
    }
    expect(matchProtection("CLASH", protectionRules([]))?.source).toBe("builtin");
  });

  test("a protected process is excluded before service-impact review", () => {
    const snapshot = snapshotFixture();
    const book = buildCandidateBook(snapshot, "fanfei", "20261030T000000-abcdef");
    const clash = {
      ...book.records[0]!,
      executable: "Clash",
    };
    const validated = validateCandidates(
      [clash],
      snapshot.processes,
      snapshot.docker.containers,
      new Map([[1059, [3000]]]),
      "fanfei",
      new Set(),
    )[0]!;

    expect(validated.eligibility.status).toBe("protected");
    expect(validated.decision).toBe("protected");
    expect(validated.protection).toEqual({ name: "clash", source: "builtin" });
  });

  test("user rules persist as normalized executable names without replacing built-ins", () => {
    const rules = protectionRules(["My Agent", "CLASH"]);
    expect(matchProtection("my agent", rules)?.source).toBe("user");
    expect(matchProtection("clash", rules)?.source).toBe("builtin");
  });
});
