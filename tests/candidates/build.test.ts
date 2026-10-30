import { describe, expect, test } from "bun:test";
import { buildCandidateBook } from "../../src/candidates/build.ts";
import { snapshotFixture } from "../helpers.ts";

describe("local candidate book", () => {
  test("keeps concrete targets private and exposes only bounded facts", () => {
    const book = buildCandidateBook(snapshotFixture(), "fanfei", "20261030T000000-abcdef");
    const serialized = JSON.stringify(book.facts);

    expect(book.records.map((candidate) => candidate.kind)).toEqual(["process", "container"]);
    expect(serialized.includes("entityId")).toBe(false);
    expect(serialized.includes("/Users/fanfei")).toBe(false);
    expect(serialized.includes("abcdef0123456789")).toBe(false);
    expect(book.facts.every((fact) => fact.candidateId.startsWith("cand_"))).toBe(true);
  });
});
